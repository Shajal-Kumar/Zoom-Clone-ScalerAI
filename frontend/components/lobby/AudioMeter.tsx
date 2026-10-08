"use client";

const SEGMENTS = 14;

/** Segmented input-level meter. `level` is 0..1 from useAudioLevel. */
export function AudioMeter({ level, muted }: { level: number; muted: boolean }) {
  const lit = muted ? 0 : Math.round(level * SEGMENTS);
  return (
    <div
      className="flex gap-1"
      role="meter"
      aria-label="Microphone level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((muted ? 0 : level) * 100)}
    >
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <span
          key={i}
          className={`h-2 flex-1 rounded-sm transition-colors ${
            i < lit ? (i > SEGMENTS - 4 ? "bg-[var(--orange)]" : "bg-[var(--blue)]") : "bg-[var(--hover)]"
          }`}
        />
      ))}
    </div>
  );
}
