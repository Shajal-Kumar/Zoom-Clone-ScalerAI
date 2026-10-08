"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Loader2, MonitorUp, Plus, Video, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";

interface Props {
  onJoin: () => void;
  onSchedule: () => void;
  onShare: () => void;
  onToast: (message: string) => void;
}

export function ActionCards({ onJoin, onSchedule, onShare, onToast }: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  async function newMeeting() {
    if (creating) return;
    setCreating(true);
    try {
      const meeting = await api.createInstant();
      router.push(`/meeting/${meeting.id}/lobby?as=host`);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Couldn't start a meeting.");
      setCreating(false);
    }
  }

  const cards: { key: string; label: string; hint: string; icon: LucideIcon; color: string; onClick: () => void; busy?: boolean }[] = [
    { key: "new", label: "New meeting", hint: "Start an instant meeting", icon: Video, color: "var(--orange)", onClick: newMeeting, busy: creating },
    { key: "join", label: "Join", hint: "Enter a meeting ID", icon: Plus, color: "var(--blue)", onClick: onJoin },
    { key: "schedule", label: "Schedule", hint: "Plan a meeting for later", icon: Calendar, color: "var(--blue)", onClick: onSchedule },
    { key: "share", label: "Share screen", hint: "Join, then present", icon: MonitorUp, color: "var(--blue)", onClick: onShare },
  ];

  return (
    <div className="grid grid-cols-2 gap-4">
      {cards.map(({ key, label, hint, icon: Icon, color, onClick, busy }) => (
        <button
          key={key}
          onClick={onClick}
          disabled={busy}
          className="group flex min-h-36 flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-left transition-colors hover:border-[var(--blue-hover)] disabled:opacity-70"
        >
          <span className="grid h-12 w-12 place-items-center rounded-xl text-white" style={{ background: color }}>
            {busy ? <Loader2 size={24} className="animate-spin" /> : <Icon size={24} />}
          </span>
          <span>
            <span className="block text-base font-semibold">{busy ? "Starting…" : label}</span>
            <span className="block text-sm text-[var(--muted)]">{hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
