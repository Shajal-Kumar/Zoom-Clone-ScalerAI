"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Envelope } from "@/lib/types";
import type { SendFn } from "./useMeetingSocket";

const RTC_CONFIG: RTCConfiguration = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

interface PeerCtx {
  id: string;
  pc: RTCPeerConnection;
  /** Perfect negotiation: exactly one side of each pair is polite (lower client_id). */
  polite: boolean;
  /** True when we created the connection to send the first offer (we are the newcomer). */
  offerer: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** Serialises signalling for this peer; handlers are async and must not interleave. */
  queue: Promise<void>;
  /** ICE candidates that arrived before the remote description. */
  pending: RTCIceCandidateInit[];
  camSenders: { audio: RTCRtpSender | null; video: RTCRtpSender | null };
  screenSenders: RTCRtpSender[];
  /** Stream used for tracks that arrive without an msid stream. */
  fallback: MediaStream | null;
  closed: boolean;
}

interface Args {
  selfId: string | null;
  send: SendFn;
  localStream: MediaStream | null;
  localVersion: number;
  screenStream: MediaStream | null;
}

const KINDS = ["audio", "video"] as const;

/**
 * Native WebRTC full mesh (one RTCPeerConnection per remote peer).
 *
 * - The newcomer offers to everybody listed in `room_state` (`connectTo`); existing peers
 *   create their connection lazily when the first offer arrives and answer it.
 * - Perfect negotiation (polite/impolite by client_id, rollback on glare) covers the cases
 *   where both sides negotiate at once: simultaneous joins, screen share start/stop, ICE restart.
 * - Camera/mic tracks are attached with addTrack(track, localStream) and later swapped with
 *   replaceTrack, so toggling or switching a device never renegotiates. The screen share is
 *   a SEPARATE stream added with addTrack(track, screenStream); receivers tell them apart by
 *   stream id (see lib/streams.ts).
 */
export function useWebRTC({ selfId, send, localStream, localVersion, screenStream }: Args) {
  const peersRef = useRef(new Map<string, PeerCtx>());
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream[]>>({});
  const watched = useRef(new WeakSet<MediaStream>());
  const appliedScreen = useRef<MediaStream | null>(null);

  const latest = useRef({ selfId, send, localStream, screenStream });
  useEffect(() => {
    latest.current = { selfId, send, localStream, screenStream };
  });

  const addRemoteStream = useCallback((peerId: string, stream: MediaStream) => {
    setRemoteStreams((prev) => {
      const list = prev[peerId] ?? [];
      const existing = list.find((s) => s.id === stream.id);
      if (existing === stream) return prev;
      const next = existing ? list.map((s) => (s.id === stream.id ? stream : s)) : [...list, stream];
      return { ...prev, [peerId]: next };
    });
  }, []);

  const removeRemoteStream = useCallback((peerId: string, stream: MediaStream) => {
    setRemoteStreams((prev) => {
      const list = prev[peerId];
      if (!list || !list.includes(stream)) return prev;
      const next = list.filter((s) => s !== stream);
      const copy = { ...prev };
      if (next.length) copy[peerId] = next;
      else delete copy[peerId];
      return copy;
    });
  }, []);

  /** Make the connection's camera/mic senders match the current local stream. */
  const syncLocal = useCallback((ctx: PeerCtx) => {
    const stream = latest.current.localStream;
    for (const kind of KINDS) {
      const track =
        (stream ? (kind === "audio" ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0]) : null) ?? null;
      const sender = ctx.camSenders[kind];
      if (sender) {
        if (sender.track !== track) sender.replaceTrack(track).catch(() => {});
      } else if (track && stream) {
        try {
          ctx.camSenders[kind] = ctx.pc.addTrack(track, stream);
        } catch {
          /* connection closed */
        }
      }
    }
  }, []);

  const addScreenTracks = useCallback((ctx: PeerCtx, stream: MediaStream) => {
    for (const track of stream.getTracks()) {
      if (ctx.pc.getSenders().some((s) => s.track === track)) continue;
      try {
        ctx.screenSenders.push(ctx.pc.addTrack(track, stream));
      } catch {
        /* connection closed */
      }
    }
  }, []);

  const removeScreenTracks = useCallback((ctx: PeerCtx) => {
    for (const sender of ctx.screenSenders) {
      try {
        ctx.pc.removeTrack(sender);
      } catch {
        /* connection closed */
      }
    }
    ctx.screenSenders = [];
  }, []);

  const closePeer = useCallback((ctx: PeerCtx) => {
    ctx.closed = true;
    ctx.pc.onicecandidate = null;
    ctx.pc.ontrack = null;
    ctx.pc.onnegotiationneeded = null;
    ctx.pc.onconnectionstatechange = null;
    try {
      ctx.pc.close();
    } catch {
      /* ignore */
    }
  }, []);

  const createPeer = useCallback(
    (peerId: string, offerer: boolean): PeerCtx => {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const ctx: PeerCtx = {
        id: peerId,
        pc,
        polite: (latest.current.selfId ?? "") < peerId,
        offerer,
        makingOffer: false,
        ignoreOffer: false,
        queue: Promise.resolve(),
        pending: [],
        camSenders: { audio: null, video: null },
        screenSenders: [],
        fallback: null,
        closed: false,
      };
      peersRef.current.set(peerId, ctx);

      pc.onicecandidate = ({ candidate }) => {
        if (candidate && !ctx.closed) latest.current.send("candidate", { candidate: candidate.toJSON() }, peerId);
      };

      pc.onnegotiationneeded = async () => {
        if (ctx.closed) return;
        // A lazily created answerer must wait for the remote offer instead of racing it.
        if (!ctx.offerer && !pc.remoteDescription) return;
        try {
          ctx.makingOffer = true;
          await pc.setLocalDescription();
          const d = pc.localDescription;
          if (d && !ctx.closed) latest.current.send("offer", { description: { type: d.type, sdp: d.sdp } }, peerId);
        } catch (err) {
          console.warn("[webrtc] negotiation failed", peerId, err);
        } finally {
          ctx.makingOffer = false;
        }
      };

      pc.ontrack = ({ track, streams }) => {
        let stream = streams[0];
        if (!stream) {
          ctx.fallback ??= new MediaStream();
          stream = ctx.fallback;
          if (!stream.getTracks().includes(track)) stream.addTrack(track);
        }
        const s = stream;
        if (!watched.current.has(s)) {
          watched.current.add(s);
          // The sender stopped this stream (e.g. screen share ended): drop it from the UI.
          s.addEventListener("removetrack", () => {
            if (s.getTracks().length === 0) removeRemoteStream(peerId, s);
          });
        }
        addRemoteStream(peerId, s);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" && !ctx.closed) pc.restartIce();
      };

      syncLocal(ctx);
      const screen = latest.current.screenStream;
      if (screen) addScreenTracks(ctx, screen);
      if (offerer) {
        // Always negotiate receiving, even with no camera or mic of our own.
        for (const kind of KINDS) {
          if (!ctx.camSenders[kind]) pc.addTransceiver(kind, { direction: "recvonly" });
        }
      }
      return ctx;
    },
    [addRemoteStream, addScreenTracks, removeRemoteStream, syncLocal],
  );

  const processSignal = useCallback(async (ctx: PeerCtx, env: Envelope) => {
    const { pc } = ctx;
    if (ctx.closed) return;

    if (env.type === "candidate") {
      const init = env.payload.candidate as RTCIceCandidateInit | undefined;
      if (!init) return;
      if (!pc.remoteDescription) {
        ctx.pending.push(init);
        return;
      }
      try {
        await pc.addIceCandidate(init);
      } catch (err) {
        if (!ctx.ignoreOffer) console.warn("[webrtc] addIceCandidate failed", err);
      }
      return;
    }

    const description = env.payload.description as RTCSessionDescriptionInit | undefined;
    if (!description) return;

    const collision = description.type === "offer" && (ctx.makingOffer || pc.signalingState !== "stable");
    ctx.ignoreOffer = !ctx.polite && collision;
    if (ctx.ignoreOffer) return;

    await pc.setRemoteDescription(description); // a polite peer rolls back its own offer implicitly
    for (const candidate of ctx.pending.splice(0)) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        /* belongs to a superseded negotiation */
      }
    }
    if (description.type === "offer") {
      await pc.setLocalDescription();
      const d = pc.localDescription;
      if (d && !ctx.closed) latest.current.send("answer", { description: { type: d.type, sdp: d.sdp } }, ctx.id);
    }
  }, []);

  /** Feed an incoming offer / answer / candidate envelope. */
  const handleSignal = useCallback(
    (env: Envelope) => {
      const from = env.from;
      if (!from) return;
      let ctx = peersRef.current.get(from);
      if (!ctx) {
        if (env.type !== "offer") return; // stray candidate/answer for a peer we dropped
        ctx = createPeer(from, false);
      }
      const target = ctx;
      target.queue = target.queue
        .then(() => processSignal(target, env))
        .catch((err) => console.warn("[webrtc] signalling error", from, err));
    },
    [createPeer, processSignal],
  );

  /** Newcomer: open a connection (and send the first offer) to every peer in room_state. */
  const connectTo = useCallback(
    (peerIds: string[]) => {
      for (const id of peerIds) {
        if (!peersRef.current.has(id)) createPeer(id, true);
      }
    },
    [createPeer],
  );

  const dropPeer = useCallback(
    (peerId: string) => {
      const ctx = peersRef.current.get(peerId);
      if (ctx) {
        closePeer(ctx);
        peersRef.current.delete(peerId);
      }
      setRemoteStreams((prev) => {
        if (!(peerId in prev)) return prev;
        const copy = { ...prev };
        delete copy[peerId];
        return copy;
      });
    },
    [closePeer],
  );

  const resetAll = useCallback(() => {
    for (const ctx of peersRef.current.values()) closePeer(ctx);
    peersRef.current.clear();
    setRemoteStreams((prev) => (Object.keys(prev).length ? {} : prev));
  }, [closePeer]);

  // Local tracks changed (device switch, permission granted late, device unplugged).
  useEffect(() => {
    for (const ctx of peersRef.current.values()) syncLocal(ctx);
  }, [localStream, localVersion, syncLocal]);

  // Local screen share started / stopped.
  useEffect(() => {
    const previous = appliedScreen.current;
    if (previous === screenStream) return;
    appliedScreen.current = screenStream;
    for (const ctx of peersRef.current.values()) {
      if (previous) removeScreenTracks(ctx);
      if (screenStream) addScreenTracks(ctx, screenStream);
    }
  }, [screenStream, addScreenTracks, removeScreenTracks]);

  useEffect(
    () => () => {
      for (const ctx of peersRef.current.values()) closePeer(ctx);
      peersRef.current.clear();
    },
    [closePeer],
  );

  return { remoteStreams, handleSignal, connectTo, dropPeer, resetAll };
}
