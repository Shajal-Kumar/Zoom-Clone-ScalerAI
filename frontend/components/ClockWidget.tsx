"use client";

import { useEffect, useState } from "react";

export function ClockWidget() {
  const [now, setNow] = useState<Date | null>(null); // null until mounted: avoids a hydration mismatch

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const date = now?.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <section aria-label="Current time" className="text-center">
      <div className="text-5xl font-semibold tracking-tight tabular-nums" role="timer" aria-live="off">
        {time ?? "--:--"}
      </div>
      <p className="mt-1 text-base text-[var(--muted)]">{date ?? " "}</p>
    </section>
  );
}
