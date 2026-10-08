"use client";

import { useEffect, useState } from "react";

type AudioContextCtor = typeof AudioContext;

let sharedCtx: AudioContext | null = null;

/** One AudioContext for the whole page: browsers cap concurrent contexts, and the room has one per tile. */
function getSharedContext(): AudioContext | null {
  if (sharedCtx && sharedCtx.state !== "closed") return sharedCtx;
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return null;
  sharedCtx = new Ctor();
  return sharedCtx;
}

/**
 * Live input level (0..1) of the audio tracks in `stream`, via an AnalyserNode.
 * Pass `active=false` (muted) to get 0 and release the analyser.
 * `version` re-runs the effect when tracks are swapped inside the same MediaStream.
 */
export function useAudioLevel(stream: MediaStream | null, version: number, active: boolean): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!stream || !active) return;
    const tracks = stream.getAudioTracks().filter((t) => t.readyState === "live");
    if (tracks.length === 0) return;

    const ctx = getSharedContext();
    if (!ctx) return;
    void ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(new MediaStream(tracks));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);

    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 60) return; // ~16 updates/s is plenty for a meter
      last = now;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) {
        const x = (v - 128) / 128;
        sum += x * x;
      }
      setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      analyser.disconnect();
      setLevel(0);
    };
  }, [stream, version, active]);

  return active ? level : 0;
}
