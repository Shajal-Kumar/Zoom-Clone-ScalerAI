"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { api, swrKeys } from "@/lib/api";
import { formatMeetingId } from "@/lib/ids";

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();

function Umbrella() {
  return (
    <svg width="96" height="84" viewBox="0 0 96 84" fill="none" aria-hidden>
      <ellipse cx="48" cy="74" rx="26" ry="6" fill="var(--hover)" />
      <path d="M50 30 L44 72" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 34 C14 14 40 6 62 12 C80 17 88 28 88 34 C70 28 60 34 50 30 C40 26 28 30 12 34 Z" fill="#c7cbf2" />
      <path d="M12 34 C28 30 40 26 50 30 C60 34 70 28 88 34" stroke="#9aa0e0" strokeWidth="2" fill="none" />
    </svg>
  );
}

export function CalendarFeed() {
  const [day, setDay] = useState<Date | null>(null); // null until mounted (no hydration mismatch)
  useEffect(() => setDay(startOfDay(new Date())), []);

  const { data } = useSWR(swrKeys.upcoming, api.list, { refreshInterval: 15000 });

  const isToday = day ? sameDay(day, new Date()) : true;
  const label = day
    ? `${isToday ? "Today" : day.toLocaleDateString("en-US", { weekday: "short" })}, ${day.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : "Today";

  const events = useMemo(() => {
    if (!day || !data) return [];
    return data.filter((m) => m.scheduled_start && sameDay(new Date(m.scheduled_start), day));
  }, [data, day]);

  const shift = (by: number) => day && setDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() + by));

  return (
    <section aria-label="Calendar" className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
      <h2 className="px-4 py-3 text-center text-sm font-semibold">{label}</h2>

      <div className="flex items-center gap-2 border-y border-[var(--border)] px-4 py-2">
        <button
          type="button"
          onClick={() => setDay(startOfDay(new Date()))}
          className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium hover:bg-[var(--hover)]"
        >
          Today
        </button>
        <button type="button" onClick={() => shift(-1)} aria-label="Previous day" className="grid h-7 w-7 place-items-center rounded-full hover:bg-[var(--hover)]">
          <ChevronLeft size={16} />
        </button>
        <button type="button" onClick={() => shift(1)} aria-label="Next day" className="grid h-7 w-7 place-items-center rounded-full hover:bg-[var(--hover)]">
          <ChevronRight size={16} />
        </button>
        <span className="ml-auto text-[var(--muted)]" aria-hidden>
          <MoreHorizontal size={16} />
        </span>
      </div>

      {events.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-4 py-8">
          <Umbrella />
          <p className="text-sm text-[var(--muted)]">No meetings scheduled.</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {events.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{m.title}</p>
                <p className="text-xs text-[var(--muted)]">
                  {new Date(m.scheduled_start as string).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · ID {formatMeetingId(m.id)}
                </p>
              </div>
              <Link
                href={`/meeting/${m.id}/lobby?as=host`}
                className="shrink-0 rounded-md bg-[var(--blue)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--blue-hover)]"
              >
                Start
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
