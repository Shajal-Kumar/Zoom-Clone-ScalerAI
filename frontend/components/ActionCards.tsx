"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, ChevronDown, CircleDot, FileText, Loader2, MonitorUp, Pencil, Plus, Video, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";

interface Props {
  onJoin: () => void;
  onSchedule: () => void;
  onShare: () => void;
  onToast: (message: string) => void;
}

const circle =
  "grid h-14 w-14 place-items-center rounded-2xl text-white transition-transform group-hover:scale-105 group-disabled:opacity-70";
const labelCls = "text-sm text-[var(--muted)] group-hover:text-[var(--text)]";

export function ActionCards({ onJoin, onSchedule, onShare, onToast }: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dayOfMonth, setDayOfMonth] = useState<number | null>(null); // set after mount (no hydration mismatch)
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDayOfMonth(new Date().getDate()), []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenuOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menuOpen]);

  async function newMeeting() {
    if (creating) return;
    setMenuOpen(false);
    setCreating(true);
    try {
      const meeting = await api.createInstant();
      router.push(`/meeting/${meeting.id}/lobby?as=host`);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Couldn't start a meeting.");
      setCreating(false);
    }
  }

  const pills: { label: string; icon: LucideIcon; tint: string }[] = [
    { label: "Recordings", icon: CircleDot, tint: "bg-red-500/10 text-red-500" },
    { label: "Summaries", icon: FileText, tint: "bg-violet-500/10 text-violet-500" },
    { label: "My Notes", icon: Pencil, tint: "bg-indigo-500/10 text-indigo-500" },
  ];

  return (
    <div className="space-y-5">
      {/* Primary actions */}
      <div className="flex items-start justify-center gap-8 sm:gap-12">
        <div ref={menuRef} className="relative flex w-28 flex-col items-center gap-2">
          <button type="button" onClick={newMeeting} disabled={creating} aria-label="New meeting" className="group">
            <span className={circle} style={{ background: "var(--orange)" }}>
              {creating ? <Loader2 size={26} className="animate-spin" /> : <Video size={26} />}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="group flex items-center gap-0.5"
          >
            <span className={labelCls}>{creating ? "Starting…" : "New meeting"}</span>
            <ChevronDown size={14} className="text-[var(--muted)]" />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute left-1/2 top-full z-20 mt-1 w-60 -translate-x-1/2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-1 shadow-lg">
              <button role="menuitem" onClick={newMeeting} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--hover)]">
                <Video size={14} /> Start an instant meeting
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onShare();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--hover)]"
              >
                <MonitorUp size={14} /> Share screen (join, then present)
              </button>
            </div>
          )}
        </div>

        <button type="button" onClick={onJoin} className="group flex w-28 flex-col items-center gap-2">
          <span className={circle} style={{ background: "var(--blue)" }}>
            <Plus size={28} />
          </span>
          <span className={labelCls}>Join</span>
        </button>

        <button type="button" onClick={onSchedule} className="group flex w-28 flex-col items-center gap-2">
          <span className={circle} style={{ background: "var(--blue)" }}>
            <span className="relative grid place-items-center">
              <Calendar size={28} aria-hidden />
              <span className="absolute inset-x-0 bottom-[5px] text-center text-[10px] font-bold leading-none">{dayOfMonth ?? ""}</span>
            </span>
          </span>
          <span className={labelCls}>Schedule</span>
        </button>
      </div>

      {/* Secondary pills (placeholders) */}
      <div className="grid grid-cols-3 gap-3">
        {pills.map(({ label, icon: Icon, tint }) => (
          <button
            key={label}
            type="button"
            onClick={() => onToast(`${label} isn't available yet.`)}
            className="flex h-14 items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-3 text-left text-sm font-semibold transition-colors hover:border-[var(--blue-hover)]"
          >
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tint}`}>
              <Icon size={16} />
            </span>
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
