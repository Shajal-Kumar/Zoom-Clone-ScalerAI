"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type MediaIssue = "denied" | "notfound" | "busy" | "insecure" | "unknown";
export interface DeviceLists {
  mics: MediaDeviceInfo[];
  cams: MediaDeviceInfo[];
}
type Kind = "audio" | "video";
interface Acquired {
  track?: MediaStreamTrack;
  issue?: MediaIssue;
}

function classify(err: unknown): MediaIssue {
  const name =
    err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "notfound";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "busy";
    default:
      return "unknown";
  }
}

function canCapture(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

const VIDEO_CONSTRAINTS: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } };

async function getSingle(kind: Kind, deviceId?: string): Promise<Acquired> {
  try {
    const device: MediaTrackConstraints | true = deviceId ? { deviceId: { exact: deviceId } } : true;
    const stream = await navigator.mediaDevices.getUserMedia(
      kind === "audio"
        ? { audio: device }
        : { video: deviceId ? { ...VIDEO_CONSTRAINTS, deviceId: { exact: deviceId } } : VIDEO_CONSTRAINTS },
    );
    const track = (kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks())[0];
    return track ? { track } : { issue: "unknown" };
  } catch (err) {
    return { issue: classify(err) };
  }
}

function stopTracks(items: Partial<Record<Kind, Acquired>>): void {
  items.audio?.track?.stop();
  items.video?.track?.stop();
}

/**
 * Local camera and microphone.
 *
 * - `stream` is ONE stable MediaStream object whose tracks are swapped in place, so the
 *   WebRTC layer can keep using it as the msid and just `replaceTrack`. `version` bumps on
 *   every change to its tracks.
 * - Muting and camera-off flip `track.enabled` (HANDOFF 5.2). Denied / missing / busy devices
 *   never throw: they set `issues` and the user can still join.
 * - `start()` is idempotent (safe under React Strict Mode); `stop()` releases the devices.
 */
export function useLocalMedia() {
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [version, setVersion] = useState(0);
  const [audioEnabled, setAudioEnabledState] = useState(true);
  const [videoEnabled, setVideoEnabledState] = useState(true);
  const audioEnabledRef = useRef(true);
  const videoEnabledRef = useRef(true);
  const [issues, setIssues] = useState<{ audio: MediaIssue | null; video: MediaIssue | null }>({
    audio: null,
    video: null,
  });
  const [devices, setDevices] = useState<DeviceLists>({ mics: [], cams: [] });
  const [micId, setMicId] = useState("");
  const [camId, setCamId] = useState("");
  const [acquiring, setAcquiring] = useState(false);
  const startedRef = useRef(false);
  const genRef = useRef(0); // bumped by stop()/acquire() to discard in-flight results

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const ensureStream = useCallback((): MediaStream => {
    if (!streamRef.current) {
      streamRef.current = new MediaStream();
      setStream(streamRef.current);
    }
    return streamRef.current;
  }, []);

  const hasLive = useCallback((kind: Kind): boolean => {
    const s = streamRef.current;
    if (!s) return false;
    const tracks = kind === "audio" ? s.getAudioTracks() : s.getVideoTracks();
    return tracks.some((t) => t.readyState === "live");
  }, []);

  const refreshDevices = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        mics: all.filter((d) => d.kind === "audioinput"),
        cams: all.filter((d) => d.kind === "videoinput"),
      });
    } catch {
      /* ignore */
    }
  }, []);

  const setTrack = useCallback(
    (kind: Kind, track: MediaStreamTrack | null) => {
      const s = ensureStream();
      for (const old of kind === "audio" ? s.getAudioTracks() : s.getVideoTracks()) {
        s.removeTrack(old);
        old.stop(); // stop() does not fire "ended", so the listener below ignores replaced tracks
      }
      if (track) {
        track.enabled = kind === "audio" ? audioEnabledRef.current : videoEnabledRef.current;
        s.addTrack(track);
        track.addEventListener("ended", () => {
          // Device unplugged or revoked while in use.
          if (!s.getTracks().includes(track)) return;
          s.removeTrack(track);
          setIssues((prev) => ({ ...prev, [kind]: "notfound" }));
          bump();
        });
        const id = track.getSettings().deviceId;
        if (id) (kind === "audio" ? setMicId : setCamId)(id);
      }
      bump();
    },
    [bump, ensureStream],
  );

  const acquire = useCallback(
    async (want: { audio: boolean; video: boolean }) => {
      if (!want.audio && !want.video) return;
      if (!canCapture()) {
        setIssues((prev) => ({
          audio: want.audio ? "insecure" : prev.audio,
          video: want.video ? "insecure" : prev.video,
        }));
        return;
      }
      const gen = ++genRef.current;
      setAcquiring(true);
      const results: Partial<Record<Kind, Acquired>> = {};

      if (want.audio && want.video) {
        // One prompt when possible; fall back to per-device calls so one missing device
        // does not take the other one down with it.
        try {
          const both = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: VIDEO_CONSTRAINTS,
          });
          results.audio = { track: both.getAudioTracks()[0] };
          results.video = { track: both.getVideoTracks()[0] };
        } catch {
          /* handled below */
        }
      }
      for (const kind of ["audio", "video"] as const) {
        if (want[kind] && !results[kind]?.track) results[kind] = await getSingle(kind);
      }

      if (gen !== genRef.current) {
        stopTracks(results); // stop() or a newer acquire() superseded this one
        return;
      }
      for (const kind of ["audio", "video"] as const) {
        const r = results[kind];
        if (!r) continue;
        if (r.track) setTrack(kind, r.track);
      }
      setIssues((prev) => ({
        audio: want.audio ? (results.audio?.track ? null : (results.audio?.issue ?? "unknown")) : prev.audio,
        video: want.video ? (results.video?.track ? null : (results.video?.issue ?? "unknown")) : prev.video,
      }));
      setAcquiring(false);
      void refreshDevices();
    },
    [refreshDevices, setTrack],
  );

  /** Idempotent. `audioEnabled` / `videoEnabled` are the initial toggle positions. */
  const start = useCallback(
    (initial: { audioEnabled: boolean; videoEnabled: boolean }) => {
      if (startedRef.current) return;
      startedRef.current = true;
      audioEnabledRef.current = initial.audioEnabled;
      videoEnabledRef.current = initial.videoEnabled;
      setAudioEnabledState(initial.audioEnabled);
      setVideoEnabledState(initial.videoEnabled);
      void acquire({ audio: true, video: true });
    },
    [acquire],
  );

  const stop = useCallback(() => {
    genRef.current += 1;
    startedRef.current = false;
    const s = streamRef.current;
    if (s) {
      for (const t of s.getTracks()) {
        s.removeTrack(t);
        t.stop();
      }
    }
    setIssues({ audio: null, video: null });
    setAcquiring(false);
    bump();
  }, [bump]);

  /** Re-prompt for whatever is missing (the banner's Retry button). */
  const retry = useCallback(() => {
    void acquire({ audio: !hasLive("audio"), video: !hasLive("video") });
  }, [acquire, hasLive]);

  const applyEnabled = useCallback((kind: Kind, enabled: boolean) => {
    const s = streamRef.current;
    if (!s) return;
    for (const t of kind === "audio" ? s.getAudioTracks() : s.getVideoTracks()) t.enabled = enabled;
  }, []);

  const setAudioEnabled = useCallback(
    (enabled: boolean) => {
      audioEnabledRef.current = enabled;
      setAudioEnabledState(enabled);
      applyEnabled("audio", enabled);
      bump();
      if (enabled && !hasLive("audio")) void acquire({ audio: true, video: false });
    },
    [acquire, applyEnabled, bump, hasLive],
  );

  const setVideoEnabled = useCallback(
    (enabled: boolean) => {
      videoEnabledRef.current = enabled;
      setVideoEnabledState(enabled);
      applyEnabled("video", enabled);
      bump();
      if (enabled && !hasLive("video")) void acquire({ audio: false, video: true });
    },
    [acquire, applyEnabled, bump, hasLive],
  );

  const toggleAudio = useCallback(
    () => setAudioEnabled(!audioEnabledRef.current),
    [setAudioEnabled],
  );
  const toggleVideo = useCallback(
    () => setVideoEnabled(!videoEnabledRef.current),
    [setVideoEnabled],
  );

  const selectDevice = useCallback(
    async (kind: Kind, deviceId: string) => {
      const r = await getSingle(kind, deviceId);
      if (r.track) {
        setTrack(kind, r.track);
        setIssues((prev) => ({ ...prev, [kind]: null }));
      } else {
        setIssues((prev) => ({ ...prev, [kind]: r.issue ?? "unknown" }));
      }
      void refreshDevices();
    },
    [refreshDevices, setTrack],
  );

  /** What the server should believe right now (read from refs, safe inside callbacks). */
  const getSnapshot = useCallback(
    () => ({
      audio: audioEnabledRef.current && hasLive("audio"),
      video: videoEnabledRef.current && hasLive("video"),
    }),
    [hasLive],
  );

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.addEventListener) return;
    const onChange = () => void refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onChange);
  }, [refreshDevices]);

  // Release the camera and microphone when the meeting route unmounts.
  useEffect(
    () => () => {
      const s = streamRef.current;
      if (s) for (const t of s.getTracks()) t.stop();
    },
    [],
  );

  // `version` is the dependency that makes these recompute when tracks change in place.
  const hasAudioTrack = useMemo(() => hasLive("audio"), [hasLive, version, stream]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasVideoTrack = useMemo(() => hasLive("video"), [hasLive, version, stream]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    stream,
    version,
    audioEnabled,
    videoEnabled,
    /** Effective state: toggle on AND a live track exists. This is what peers see. */
    audioOn: audioEnabled && hasAudioTrack,
    videoOn: videoEnabled && hasVideoTrack,
    hasAudioTrack,
    hasVideoTrack,
    audioIssue: issues.audio,
    videoIssue: issues.video,
    acquiring,
    devices,
    micId,
    camId,
    start,
    stop,
    retry,
    setAudioEnabled,
    setVideoEnabled,
    toggleAudio,
    toggleVideo,
    selectDevice,
    getSnapshot,
  };
}

export type LocalMedia = ReturnType<typeof useLocalMedia>;

export function describeMediaIssue(kind: "Camera" | "Microphone", issue: MediaIssue): string {
  switch (issue) {
    case "denied":
      return `${kind} access is blocked. Allow it from the lock icon in the address bar, then press Retry.`;
    case "notfound":
      return `No ${kind.toLowerCase()} was found on this device.`;
    case "busy":
      return `${kind} is in use by another app or tab. Close it and press Retry.`;
    case "insecure":
      return `${kind} needs a secure page. Use http://localhost:3000 or https.`;
    default:
      return `${kind} could not be started.`;
  }
}
