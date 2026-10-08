"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ShieldCheck, Users } from "lucide-react";
import { useDismiss } from "@/hooks/useDismiss";
import { copyText } from "@/lib/clipboard";
import { useMeeting } from "@/providers/MeetingProvider";

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export function MeetingHeader() {
  const { lookup, meetingId, joinedAt, participants, maxParticipants, notify } = useMeeting();
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [shieldOpen, setShieldOpen] = useState(false);
  const shieldRef = useRef<HTMLDivElement>(null);
  useDismiss(shieldRef, shieldOpen, () => setShieldOpen(false));

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const title = lookup.status === "ready" ? lookup.meeting.title : "Meeting";
  const count = participants.length + 1;

  async function copyInvite() {
    const link = `${window.location.origin}/meeting/${meetingId}`;
    const ok = await copyText(link);
    setCopied(ok);
    notify(ok ? "Invite link copied to clipboard." : "Couldn't copy. Share this link: " + link);
  }

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[#13151B] px-3 text-sm sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <div ref={shieldRef} className="relative">
          <button
            onClick={() => setShieldOpen((o) => !o)}
            aria-expanded={shieldOpen}
            aria-label="Meeting security information"
            className="flex h-8 w-8 items-center justify-center rounded-md text-emerald-400 hover:bg-white/10"
          >
            <ShieldCheck size={18} />
          </button>
          {shieldOpen && (
            <div
              role="dialog"
              className="absolute left-0 top-10 z-50 w-72 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-xs leading-relaxed shadow-xl"
            >
              <p className="mb-1 text-sm font-semibold">Connection security</p>
              Audio and video travel directly between participants over WebRTC, which encrypts media
              (DTLS-SRTP). Meeting signalling goes through this app&apos;s server.
            </div>
          )}
        </div>
        <span className="truncate font-semibold">{title}</span>
        <span className="hidden shrink-0 font-mono text-xs text-[var(--muted)] sm:inline" aria-label="Meeting duration">
          {joinedAt ? formatElapsed(now - joinedAt) : "00:00:00"}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span className="flex items-center gap-1 text-xs text-[var(--muted)]" aria-label={`${count} of ${maxParticipants} participants`}>
          <Users size={14} aria-hidden /> {count}/{maxParticipants}
        </span>
        <button
          onClick={copyInvite}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 text-xs font-medium hover:bg-white/10"
        >
          {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
          <span className="hidden sm:inline">Copy Invite Link</span>
          <span className="sm:hidden">Invite</span>
        </button>
      </div>
    </header>
  );
}
