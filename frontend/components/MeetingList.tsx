"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Calendar, ChevronDown, Copy, Link2, RefreshCw } from "lucide-react";
import { api, swrKeys } from "@/lib/api";
import { formatMeetingId } from "@/lib/ids";
import { buildInvitation, copyText, formatWhen, meetingLink } from "@/lib/invite";
import type { Meeting } from "@/lib/types";
import { secondaryBtn, primaryBtn } from "./ui/Modal";

type Tab = "upcoming" | "recent";

function InviteMenu({ meeting, onToast }: { meeting: Meeting; onToast: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  async function copy(text: string, done: string) {
    setOpen(false);
    onToast((await copyText(text)) ? done : "Couldn't copy. Select the text and copy it manually.");
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} className={secondaryBtn}>
        <Copy size={14} /> Invite <ChevronDown size={14} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-[var(--border)] bg-[var(--card)] p-1 shadow-lg">
          <button role="menuitem" onClick={() => copy(meetingLink(meeting.id), "Invite link copied")} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--hover)]">
            <Link2 size={14} /> Copy invite link
          </button>
          <button role="menuitem" onClick={() => copy(buildInvitation(meeting), "Invitation copied")} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--hover)]">
            <Copy size={14} /> Copy invitation
          </button>
        </div>
      )}
    </div>
  );
}

function Badge({ status }: { status: Meeting["status"] }) {
  if (status === "active")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-600">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live
      </span>
    );
  return <span className="rounded-full bg-[var(--hover)] px-2.5 py-0.5 text-xs font-medium text-[var(--muted)]">Ended</span>;
}

function Row({ meeting, tab, onToast }: { meeting: Meeting; tab: Tab; onToast: (m: string) => void }) {
  const when = formatWhen(meeting.scheduled_start ?? meeting.created_at);
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-base font-semibold">{meeting.title}</h3>
          {tab === "recent" && <Badge status={meeting.status} />}
        </div>
        <p className="mt-1 text-sm text-[var(--muted)]">{when}</p>
        <p className="text-sm text-[var(--muted)]">
          Meeting ID {formatMeetingId(meeting.id)} · Host {meeting.host?.name ?? "Unknown"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {tab === "upcoming" && (
          <>
            <InviteMenu meeting={meeting} onToast={onToast} />
            <Link href={`/meeting/${meeting.id}/lobby?as=host`} className={primaryBtn}>Start</Link>
          </>
        )}
        {tab === "recent" && meeting.status === "active" && (
          <Link href={`/meeting/${meeting.id}/lobby?as=host`} className={primaryBtn}>Join</Link>
        )}
      </div>
    </li>
  );
}

const Skeleton = () => (
  <ul className="space-y-3" aria-hidden>
    {[0, 1, 2].map((i) => <li key={i} className="h-24 animate-pulse rounded-xl bg-[var(--hover)]" />)}
  </ul>
);

export const MeetingList = forwardRef<HTMLElement, { onToast: (m: string) => void }>(function MeetingList({ onToast }, ref) {
  const [tab, setTab] = useState<Tab>("upcoming");
  const opts = { refreshInterval: 15000 };
  const upcoming = useSWR(swrKeys.upcoming, api.list, opts);
  const recent = useSWR(swrKeys.recent, api.list, opts);
  const current = tab === "upcoming" ? upcoming : recent;

  const tabBtn = (id: Tab, label: string, count?: number) => (
    <button
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`border-b-2 px-1 pb-2 text-sm font-semibold transition-colors ${
        tab === id ? "border-[var(--blue)] text-[var(--blue)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
      }`}
    >
      {label}{count !== undefined && ` (${count})`}
    </button>
  );

  return (
    <section ref={ref} id="meetings" aria-label="Meetings" className="scroll-mt-20">
      <div role="tablist" className="mb-4 flex gap-6 border-b border-[var(--border)]">
        {tabBtn("upcoming", "Upcoming meetings", upcoming.data?.length)}
        {tabBtn("recent", "Recent meetings", recent.data?.length)}
      </div>

      {current.error ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
          <p className="text-sm">{current.error instanceof Error ? current.error.message : "Couldn't load meetings."}</p>
          <button onClick={() => current.mutate()} className={secondaryBtn}><RefreshCw size={14} /> Try again</button>
        </div>
      ) : !current.data ? (
        <Skeleton />
      ) : current.data.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--border)] p-10 text-center">
          <Calendar size={28} className="text-[var(--muted)]" />
          <p className="text-sm text-[var(--muted)]">
            {tab === "upcoming" ? "Nothing scheduled. Use Schedule to plan a meeting." : "No meetings yet. Start one with New meeting."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {current.data.map((m) => <Row key={m.id} meeting={m} tab={tab} onToast={onToast} />)}
        </ul>
      )}
    </section>
  );
});
