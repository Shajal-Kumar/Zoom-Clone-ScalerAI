"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SendFn } from "./useMeetingSocket";

export interface ShareConflict {
  sharerId: string | null;
  sharerName: string;
}

interface Options {
  send: SendFn;
  onNotice?: (message: string) => void;
}

function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/**
 * Local screen share (A6, A11).
 *
 * `stream` is the share that is currently announced to the room; useWebRTC adds its tracks to
 * every connection as a separate stream. Starting is optimistic: tracks go out immediately and
 * `screen_share {active:true, stream_id}` is sent. If the server answers `share_in_progress`
 * the tracks are pulled back (but kept alive) and `conflict` asks the user whether to replace
 * the current sharer, which resends with `force:true`.
 */
export function useScreenShare({ send, onNotice }: Options) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [conflict, setConflict] = useState<ShareConflict | null>(null);
  const activeRef = useRef<MediaStream | null>(null);
  const heldRef = useRef<MediaStream | null>(null);

  const cb = useRef({ send, onNotice });
  useEffect(() => {
    cb.current = { send, onNotice };
  });

  const clearActive = useCallback(() => {
    const s = activeRef.current;
    activeRef.current = null;
    setStream(null);
    stopTracks(s);
  }, []);

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    cb.current.send("screen_share", { active: false });
    clearActive();
  }, [clearActive]);

  const announce = useCallback((s: MediaStream, force: boolean) => {
    activeRef.current = s;
    setStream(s);
    cb.current.send("screen_share", {
      active: true,
      stream_id: s.id,
      ...(force ? { force: true } : {}),
    });
  }, []);

  const start = useCallback(async () => {
    if (activeRef.current || heldRef.current) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      cb.current.onNotice?.("Screen sharing isn't supported in this browser.");
      return;
    }
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch {
      return; // cancelled in the OS picker: silent no-op (5.4)
    }
    // The browser's own "Stop sharing" button ends the track.
    s.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (activeRef.current === s) {
        stop();
      } else if (heldRef.current === s) {
        heldRef.current = null;
        setConflict(null);
        stopTracks(s);
      }
    });
    announce(s, false);
  }, [announce, stop]);

  /** Server said someone else is already sharing. */
  const handleShareInProgress = useCallback((info: { sharer_id?: string; sharer_name?: string }) => {
    const s = activeRef.current;
    if (!s) return;
    activeRef.current = null;
    setStream(null); // pulls the tracks off every connection; the tracks themselves keep running
    heldRef.current = s;
    setConflict({ sharerId: info.sharer_id ?? null, sharerName: info.sharer_name ?? "Someone" });
  }, []);

  const confirmReplace = useCallback(() => {
    const s = heldRef.current;
    if (!s) return;
    heldRef.current = null;
    setConflict(null);
    announce(s, true);
  }, [announce]);

  const cancelReplace = useCallback(() => {
    stopTracks(heldRef.current);
    heldRef.current = null;
    setConflict(null);
  }, []);

  /** screen_share {active:false} addressed to our own share (replaced / stopped_by_host / left). */
  const handleStoppedByServer = useCallback(
    (reason: string | undefined) => {
      if (!activeRef.current) return;
      clearActive();
      if (reason === "stopped_by_host") cb.current.onNotice?.("The host stopped your screen share.");
      else if (reason === "replaced") cb.current.onNotice?.("Another participant started sharing their screen.");
    },
    [clearActive],
  );

  /** After a reconnect the server forgot our share; announce it again. */
  const reannounce = useCallback(() => {
    const s = activeRef.current;
    if (s) cb.current.send("screen_share", { active: true, stream_id: s.id });
  }, []);

  useEffect(
    () => () => {
      stopTracks(activeRef.current);
      stopTracks(heldRef.current);
    },
    [],
  );

  return {
    stream,
    conflict,
    start,
    stop,
    confirmReplace,
    cancelReplace,
    handleShareInProgress,
    handleStoppedByServer,
    reannounce,
  };
}
