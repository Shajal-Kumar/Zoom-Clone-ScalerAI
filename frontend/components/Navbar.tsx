"use client";

import { useState } from "react";
import { Moon, Search, Settings as Gear, Sun, Video } from "lucide-react";
import { DEFAULT_USER } from "@/lib/config";
import { useSettings } from "@/providers/SettingsProvider";
import { SettingsModal } from "./SettingsModal";

export type NavTarget = "home" | "meetings";

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export function Navbar({ active, onNavigate }: { active: NavTarget; onNavigate: (t: NavTarget) => void }) {
  const { settings, toggleTheme } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dark = settings.theme === "dark";

  const link = (target: NavTarget, label: string) => (
    <button
      onClick={() => onNavigate(target)}
      aria-current={active === target ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active === target ? "bg-[var(--hover)] text-[var(--blue)]" : "text-[var(--muted)] hover:text-[var(--text)]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--card)]">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--blue)] text-white" aria-hidden>
            <Video size={18} />
          </span>
          <span className="hidden text-base font-semibold sm:inline">Zoom Clone</span>
        </div>

        <nav className="ml-2 flex items-center gap-1" aria-label="Primary">
          {link("home", "Home")}
          {link("meetings", "Meetings")}
        </nav>

        <div className="relative mx-auto hidden w-full max-w-sm md:block">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input
            type="search"
            readOnly
            placeholder="Search"
            aria-label="Search (not available yet)"
            title="Search is not available yet"
            className="w-full cursor-default rounded-full border border-[var(--border)] bg-[var(--bg)] py-1.5 pl-9 pr-3 text-sm placeholder:text-[var(--muted)]"
          />
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={toggleTheme}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          >
            <Gear size={18} />
          </button>
          <div className="ml-1 flex items-center gap-2" title={`${DEFAULT_USER.name} (${DEFAULT_USER.id})`}>
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--blue)] text-xs font-semibold text-white">
              {initials(DEFAULT_USER.name)}
            </span>
            <span className="hidden text-sm font-medium lg:inline">{DEFAULT_USER.name}</span>
          </div>
        </div>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
