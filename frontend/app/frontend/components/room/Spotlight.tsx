"use client";

import { useEffect, useRef } from "react";
import { MonitorUp } from "lucide-react";

interface SpotlightProps {
  /** Remote screen stream; null while it is still arriving. */
  stream: MediaStream | null;
  sharerName: string;
  /** We are the sharer: show a placeholder instead of a mirror-in-mirror. */
  local?: boolean;
  onStop?: () => void;
}

export function Spotlight({ stream, sharerName, local = false, onStop }: SpotlightProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) el.play().catch(() => {});
  }, [stream]);

  return (
    <div className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden rounded-xl bg-black">
      {local ? (
        <div className="flex flex-col items-center gap-3 text-center text-[var(--text)]">
          <MonitorUp size={40} className="text-[var(--blue-hover)]" aria-hidden />
          <p className="text-lg font-semibold">You are sharing your screen</p>
          {onStop && (
            <button
              onClick={onStop}
              className="rounded-lg bg-[var(--danger)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Stop sharing
            </button>
          )}
        </div>
      ) : (
        <>
          <video ref={ref} autoPlay playsInline className="h-full w-full object-contain" />
          {!stream && (
            <p className="absolute text-sm text-[var(--muted)]">Loading {sharerName}&apos;s shared screen…</p>
          )}
          <span className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white">
            {sharerName} is sharing
          </span>
        </>
      )}
    </div>
  );
}
