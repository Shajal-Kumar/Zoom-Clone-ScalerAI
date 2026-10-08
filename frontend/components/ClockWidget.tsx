"use client";

import { useEffect, useState } from "react";

export function ClockWidget() {
  const [now, setNow] = useState<Date | null>(null); // null until mounted: avoids a hydration mismatch

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const parts = now?.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).match(/^(\d+:\d+):(\d+)\s(AM|PM)$/);
  const date = now?.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <section
      aria-label="Current time"
      className="flex h-full min-h-48 flex-col justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6"
    >
      <div className="flex items-baseline gap-2 tabular-nums" role="timer" aria-live="off">
        <span className="text-5xl font-semibold tracking-tight sm:text-6xl">{parts ? parts[1] : "--:--"}</span>
        <span className="text-xl font-medium text-[var(--muted)]">{parts ? parts[3] : ""}</span>
        <span className="w-8 text-base text-[var(--muted)]">{parts ? `:${parts[2]}` : ""}</span>
      </div>
      <p className="mt-2 text-sm text-[var(--muted)]">{date ?? "\u00a0"}</p>
    </section>
  );
}
