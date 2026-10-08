"use client";

import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { classifyClose, type EndReason } from "@/lib/close-codes";
import { DEFAULT_USER } from "@/lib/config";
import { endHref, lobbyHref } from "@/lib/routes";
import { clearStoredPasscode, getClientId } from "@/lib/storage";
import type {
  ChatMessage,
  HostActionName,
  Envelope,
  ErrorPayload,
  PeerInfo,
  PublicMeeting,
  ReactionEvent,
  RoomStatePayload,
} from "@/lib/types";
import { useLocalMedia, type LocalMedia } from "@/hooks/useLocalMedia";
import { useMeetingSocket, type SendFn, type SocketStatus } from "@/hooks/useMeetingSocket";
import { useScreenShare, type ShareConflict } from "@/hooks/useScreenShare";
import { useWebRTC } from "@/hooks/useWebRTC";

/* ------------------------------------------------------------------ */
/* Public types                                                         */
/* ------------------------------------------------------------------ */

export type Phase = "lobby" | "joining" | "joined" | "left";

export interface JoinConfig {
  displayName: string;
  isHost: boolean;
  /** Verified passcode for guests of protected meetings. Hosts bypass it (A3). */
  passcode?: string;
  /** Lobby opened with ?intent=share: show the share-screen call-to-action once (A7). */
  shareIntent: boolean;
  /** Lobby query string without "?" (as=host, intent=share), kept so /room can bounce back. */
  search: string;
}

export type LookupState =
  | { status: "loading" }
  | { status: "ready"; meeting: PublicMeeting }
  | { status: "ended"; meeting: PublicMeeting }
  | { status: "notfound" }
  | { status: "error"; message: string };

export interface MeetingContextValue {
  /** The [id] segment as typed in the URL. */
  routeId: string;
  /** Canonical 3-4-4 id once the lookup has resolved, otherwise routeId. */
  meetingId: string;
  lookup: LookupState;
  reloadLookup: () => void;

  phase: Phase;
  selfId: string | null;
  self: PeerInfo | null;
  displayName: string;
  isHost: boolean;
  /** Everyone else in the room, in join order. */
  participants: PeerInfo[];
  maxParticipants: number;
  chat: ChatMessage[];
  /** Reactions currently floating over the room. */
  reactions: ReactionEvent[];
  dismissReaction: (id: string) => void;
  /** When this tab's room_state arrived (ms epoch); basis for the header timer. */
  joinedAt: number | null;

  media: LocalMedia;
  /** All streams received from each remote peer, keyed by client_id (see lib/streams.ts). */
  remoteStreams: Record<string, MediaStream[]>;

  socketStatus: SocketStatus;
  reconnect: () => void;

  screen: {
    local: MediaStream | null;
    conflict: ShareConflict | null;
    start: () => void;
    stop: () => void;
    confirmReplace: () => void;
    cancelReplace: () => void;
  };
  shareCta: boolean;
  dismissShareCta: () => void;
  toast: string | null;
  notify: (message: string) => void;

  sendChat: (text: string) => boolean;
  setHand: (raised: boolean) => void;
  sendReaction: (emoji: string) => void;
  /** Host-only on the server; non-hosts get an error toast. */
  hostAction: (action: HostActionName, targetId?: string) => void;

  join: (config: JoinConfig) => void;
  /** User pressed Leave: tear everything down and go to /end?reason=left. */
  leave: () => void;
  /** Back to the lobby with the camera kept running (browser Back from the room, 4005). */
  resetToLobby: () => void;
  /** Idempotent full teardown without navigating (end page). */
  shutdown: () => void;
}

/* ------------------------------------------------------------------ */
/* Reducer                                                              */
/* ------------------------------------------------------------------ */

interface State {
  phase: Phase;
  self: PeerInfo | null;
  peers: Record<string, PeerInfo>;
  order: string[];
  chat: ChatMessage[];
  maxParticipants: number;
}

type Action =
  | { type: "PHASE"; phase: Phase }
  | { type: "RESET"; phase: Phase }
  | { type: "ROOM_STATE"; payload: RoomStatePayload }
  | { type: "USER_JOINED"; peer: PeerInfo }
  | { type: "USER_LEFT"; id: string }
  | { type: "MEDIA"; id: string; audio: boolean; video: boolean }
  | { type: "HAND"; id: string; at: string | null }
  | { type: "SCREEN"; id: string; active: boolean; streamId: string | null }
  | { type: "CHAT"; message: ChatMessage };

const initialState: State = {
  phase: "lobby",
  self: null,
  peers: {},
  order: [],
  chat: [],
  maxParticipants: 6,
};

function patchPeer(state: State, id: string, patch: Partial<PeerInfo>): State {
  if (state.self?.client_id === id) return { ...state, self: { ...state.self, ...patch } };
  const peer = state.peers[id];
  if (!peer) return state;
  return { ...state, peers: { ...state.peers, [id]: { ...peer, ...patch } } };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "PHASE":
      return { ...state, phase: action.phase };
    case "RESET":
      return { ...initialState, phase: action.phase };
    case "ROOM_STATE": {
      const { self, peers, chat_history, max_participants } = action.payload;
      return {
        phase: "joined",
        self,
        peers: Object.fromEntries(peers.map((p) => [p.client_id, p])),
        order: peers.map((p) => p.client_id),
        chat: chat_history,
        maxParticipants: max_participants,
      };
    }
    case "USER_JOINED": {
      const { peer } = action;
      return {
        ...state,
        peers: { ...state.peers, [peer.client_id]: peer },
        order: state.order.includes(peer.client_id) ? state.order : [...state.order, peer.client_id],
      };
    }
    case "USER_LEFT": {
      if (!(action.id in state.peers)) return state;
      const peers = { ...state.peers };
      delete peers[action.id];
      return { ...state, peers, order: state.order.filter((id) => id !== action.id) };
    }
    case "MEDIA":
      return patchPeer(state, action.id, { audio: action.audio, video: action.video });
    case "HAND":
      return patchPeer(state, action.id, { hand_raised_at: action.at });
    case "SCREEN": {
      if (action.active) {
        // One sharer per room: a new start implicitly ends everybody else's share.
        const peers = Object.fromEntries(
          Object.entries(state.peers).map(([id, p]) => [
            id,
            id === action.id
              ? { ...p, is_sharing: true, screen_stream_id: action.streamId }
              : p.is_sharing
                ? { ...p, is_sharing: false, screen_stream_id: null }
                : p,
          ]),
        );
        return { ...state, peers };
      }
      return patchPeer(state, action.id, { is_sharing: false, screen_stream_id: null });
    }
    case "CHAT":
      return { ...state, chat: [...state.chat, action.message].slice(-200) };
  }
}

/* ------------------------------------------------------------------ */
/* Provider                                                             */
/* ------------------------------------------------------------------ */

const MeetingContext = createContext<MeetingContextValue | null>(null);

export function MeetingProvider({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const routeId = params.id;

  /* ---- meeting lookup (public view; used by lobby and room) ---- */
  const [lookup, setLookup] = useState<LookupState>({ status: "loading" });
  const [lookupKey, setLookupKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLookup({ status: "loading" });
    api
      .lookup(routeId)
      .then((res) => {
        if (cancelled) return;
        if (!res.exists || !res.meeting) setLookup({ status: "notfound" });
        else if (res.meeting.status === "ended") setLookup({ status: "ended", meeting: res.meeting });
        else setLookup({ status: "ready", meeting: res.meeting });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLookup({ status: "error", message: err instanceof Error ? err.message : "Something went wrong." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [routeId, lookupKey]);
  const reloadLookup = useCallback(() => setLookupKey((k) => k + 1), []);
  const meetingId = lookup.status === "ready" || lookup.status === "ended" ? lookup.meeting.id : routeId;

  /* ---- session state ---- */
  const [state, dispatch] = useReducer(reducer, initialState);
  const [clientId, setClientId] = useState<string | null>(null);
  const [joinConfig, setJoinConfig] = useState<JoinConfig | null>(null);
  const joinRef = useRef<JoinConfig | null>(null);
  const [shareCta, setShareCta] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const lastSentMedia = useRef<{ audio: boolean; video: boolean } | null>(null);
  const [reactions, setReactions] = useState<ReactionEvent[]>([]);
  const [joinedAt, setJoinedAt] = useState<number | null>(null);
  const reactionSeq = useRef(0);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  /* ---- hooks (socket <-> webrtc <-> screen share are wired through refs) ---- */
  const media = useLocalMedia();
  const sendRef = useRef<SendFn>(() => false);
  const send = useCallback<SendFn>((type, payload, to) => sendRef.current(type, payload, to), []);

  const screen = useScreenShare({ send, onNotice: setToast });
  const webrtc = useWebRTC({
    selfId: clientId,
    send,
    localStream: media.stream,
    localVersion: media.version,
    screenStream: screen.stream,
  });

  const { getSnapshot } = media;
  const getSocketParams = useCallback(() => {
    const cfg = joinRef.current;
    const snap = getSnapshot();
    return {
      name: cfg?.displayName ?? "Guest",
      userId: cfg?.isHost ? DEFAULT_USER.id : undefined, // A2: only ?as=host sends user_id
      passcode: cfg?.isHost ? undefined : cfg?.passcode,
      audio: snap.audio,
      video: snap.video,
    };
  }, [getSnapshot]);

  /* ---- teardown helpers ---- */
  const shutdown = useCallback(() => {
    screen.stop();
    webrtc.resetAll();
    media.stop();
    setToast(null);
    setShareCta(false);
    setReactions([]);
    setJoinedAt(null);
    lastSentMedia.current = null;
    dispatch({ type: "RESET", phase: "left" });
  }, [screen, webrtc, media]);

  const finish = (reason: EndReason) => {
    shutdown();
    router.replace(endHref(meetingId, reason));
  };

  const resetToLobby = useCallback(() => {
    screen.stop();
    webrtc.resetAll();
    setToast(null);
    setShareCta(false);
    setReactions([]);
    setJoinedAt(null);
    lastSentMedia.current = null;
    dispatch({ type: "RESET", phase: "lobby" });
  }, [screen, webrtc]);

  /* ---- incoming messages ---- */
  const handleMessage = (env: Envelope) => {
    const from = env.from;
    switch (env.type) {
      case "room_state": {
        const payload = env.payload as unknown as RoomStatePayload;
        // A fresh room_state (first join or after a reconnect) means: rebuild every connection.
        webrtc.resetAll();
        dispatch({ type: "ROOM_STATE", payload });
        setJoinedAt((prev) => prev ?? Date.now()); // survives reconnects so the timer doesn't restart
        webrtc.connectTo(payload.peers.map((p) => p.client_id)); // newcomer offers (5.2)
        lastSentMedia.current = { audio: payload.self.audio, video: payload.self.video };
        screen.reannounce();
        break;
      }
      case "user_joined":
        dispatch({ type: "USER_JOINED", peer: env.payload as unknown as PeerInfo });
        break; // existing peers wait for the newcomer's offer
      case "user_left":
        if (from) {
          dispatch({ type: "USER_LEFT", id: from });
          webrtc.dropPeer(from);
        }
        break;
      case "offer":
      case "answer":
      case "candidate":
        webrtc.handleSignal(env);
        break;
      case "chat_message":
        dispatch({ type: "CHAT", message: env.payload as unknown as ChatMessage });
        break;
      case "media_state":
        if (from) {
          dispatch({
            type: "MEDIA",
            id: from,
            audio: env.payload.audio === true,
            video: env.payload.video === true,
          });
        }
        break;
      case "raise_hand":
        if (from) {
          dispatch({
            type: "HAND",
            id: from,
            at: env.payload.raised === true ? ((env.payload.hand_raised_at as string | null) ?? null) : null,
          });
        }
        break;
      case "screen_share": {
        if (!from) break;
        const active = env.payload.active === true;
        if (from === clientId) {
          // Addressed to our own share: replaced / stopped_by_host / left.
          if (!active) screen.handleStoppedByServer(env.payload.reason as string | undefined);
        } else {
          dispatch({
            type: "SCREEN",
            id: from,
            active,
            streamId: active ? ((env.payload.stream_id as string | undefined) ?? null) : null,
          });
        }
        break;
      }
      case "host_action": {
        const action = env.payload.action;
        if (action === "mute" || action === "mute_all") {
          media.setAudioEnabled(false);
          setToast("The host muted you. You can unmute yourself.");
        }
        break; // kick / end_meeting arrive as close codes 4003 / 4001; stop_share arrives as screen_share
      }
      case "error": {
        const err = env.payload as unknown as ErrorPayload;
        if (err.code === "share_in_progress") screen.handleShareInProgress(err);
        else if (err.message) setToast(err.message);
        else console.warn("[ws] server error", err.code);
        break;
      }
      case "reaction": {
        const emoji = typeof env.payload.emoji === "string" ? env.payload.emoji : null;
        if (!emoji) break;
        const sender = from === clientId ? null : state.peers[from ?? ""];
        reactionSeq.current += 1;
        const event: ReactionEvent = {
          id: `r${reactionSeq.current}`,
          emoji,
          sender_id: from,
          sender_name: from === clientId ? "You" : (sender?.display_name ?? "Someone"),
          x: 8 + Math.random() * 84,
        };
        setReactions((prev) => [...prev.slice(-24), event]);
        break;
      }
      default:
        break;
    }
  };

  const handleTerminal = (code: number) => {
    const outcome = classifyClose(code);
    if (outcome.kind === "passcode") {
      // 4005: back to the lobby passcode prompt, never auto-retry (A5).
      clearStoredPasscode(meetingId);
      resetToLobby();
      router.replace(lobbyHref(meetingId, joinRef.current?.search, { e: "passcode" }));
    } else if (outcome.kind === "end") {
      finish(outcome.reason);
    }
  };

  const onMessageRef = useRef(handleMessage);
  const onTerminalRef = useRef(handleTerminal);
  useEffect(() => {
    onMessageRef.current = handleMessage;
    onTerminalRef.current = handleTerminal;
  });
  const stableOnMessage = useCallback((env: Envelope) => onMessageRef.current(env), []);
  const stableOnTerminal = useCallback((code: number) => onTerminalRef.current(code), []);

  const socket = useMeetingSocket({
    enabled: state.phase === "joining" || state.phase === "joined",
    meetingId,
    clientId,
    getParams: getSocketParams,
    onMessage: stableOnMessage,
    onTerminal: stableOnTerminal,
  });
  useEffect(() => {
    sendRef.current = socket.send;
  }, [socket.send]);

  /* ---- keep the server's view of our mic/camera current ---- */
  const audioOn = media.audioOn;
  const videoOn = media.videoOn;
  useEffect(() => {
    if (state.phase !== "joined") return;
    const last = lastSentMedia.current;
    if (last && last.audio === audioOn && last.video === videoOn) return;
    if (send("media_state", { audio: audioOn, video: videoOn })) {
      lastSentMedia.current = { audio: audioOn, video: videoOn };
    }
  }, [state.phase, audioOn, videoOn, send]);

  /* ---- actions ---- */
  const join = useCallback((config: JoinConfig) => {
    joinRef.current = config;
    setJoinConfig(config);
    setClientId(getClientId());
    setShareCta(config.shareIntent);
    lastSentMedia.current = null;
    dispatch({ type: "PHASE", phase: "joining" });
  }, []);

  const notify = useCallback((message: string) => setToast(message), []);
  const dismissReaction = useCallback(
    (id: string) => setReactions((prev) => prev.filter((r) => r.id !== id)),
    [],
  );
  const sendChat = useCallback(
    (text: string) => {
      const trimmed = text.trim().slice(0, 2000);
      if (!trimmed) return false;
      return send("chat_message", { text: trimmed });
    },
    [send],
  );
  const setHand = useCallback((raised: boolean) => void send("raise_hand", { raised }), [send]);
  const sendReaction = useCallback((emoji: string) => void send("reaction", { emoji }), [send]);
  const hostAction = useCallback(
    (action: HostActionName, targetId?: string) => {
      void send("host_action", targetId ? { action, target_client_id: targetId } : { action });
    },
    [send],
  );

  const value: MeetingContextValue = {
    routeId,
    meetingId,
    lookup,
    reloadLookup,

    phase: state.phase,
    selfId: clientId,
    self: state.self,
    displayName: joinConfig?.displayName ?? "",
    isHost: joinConfig?.isHost ?? false,
    participants: state.order.map((id) => state.peers[id]).filter((p): p is PeerInfo => Boolean(p)),
    maxParticipants: state.maxParticipants,
    chat: state.chat,
    reactions,
    dismissReaction,
    joinedAt,

    media,
    remoteStreams: webrtc.remoteStreams,

    socketStatus: socket.status,
    reconnect: socket.reconnect,

    screen: {
      local: screen.stream,
      conflict: screen.conflict,
      start: () => void screen.start(),
      stop: screen.stop,
      confirmReplace: screen.confirmReplace,
      cancelReplace: screen.cancelReplace,
    },
    shareCta,
    dismissShareCta: () => setShareCta(false),
    toast,
    notify,

    sendChat,
    setHand,
    sendReaction,
    hostAction,

    join,
    leave: () => finish("left"),
    resetToLobby,
    shutdown,
  };

  return <MeetingContext.Provider value={value}>{children}</MeetingContext.Provider>;
}

export function useMeeting(): MeetingContextValue {
  const ctx = useContext(MeetingContext);
  if (!ctx) throw new Error("useMeeting must be used inside <MeetingProvider>");
  return ctx;
}
