"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, ChevronLeft, ChevronRight, Clock, Moon, Search, Settings as Gear, Sun } from "lucide-react";
import { DEFAULT_USER } from "@/lib/config";
import { useSettings } from "@/providers/SettingsProvider";

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

const iconBtn =
  "grid h-8 w-8 place-items-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)]";

export function Navbar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const router = useRouter();
  const { settings, toggleTheme } = useSettings();
  const dark = settings.theme === "dark";

  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Ctrl/Cmd+K focuses the (dummy) search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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

  return (
    <header className="z-40 flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4">
      <div className="flex flex-1 items-center gap-3">
        <span className="text-2xl font-extrabold lowercase tracking-tight text-[var(--blue)]" aria-label="Zoom Clone">
          zoom
        </span>
        <span className="hidden h-5 w-px bg-[var(--border)] sm:block" aria-hidden />
        <span className="hidden text-lg font-medium sm:inline">Workplace</span>
      </div>

      {/* Centered group: history buttons + search */}
      <div className="flex min-w-0 flex-[2] items-center justify-center gap-2">
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={() => router.back()} aria-label="Back" className={iconBtn}>
          <ChevronLeft size={18} />
        </button>
        <button type="button" onClick={() => router.forward()} aria-label="Forward" className={iconBtn}>
          <ChevronRight size={18} />
        </button>
        <button type="button" aria-label="History (not available yet)" title="History is not available yet" className={iconBtn}>
          <Clock size={16} />
        </button>
      </div>

      <div className="relative hidden w-full max-w-md md:block">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              e.currentTarget.blur();
            }
          }}
          placeholder="Search  Ctrl+K"
          aria-label="Search"
          className="w-full rounded-lg border border-transparent bg-[var(--hover)] py-2 pl-9 pr-3 text-sm placeholder:text-[var(--muted)] focus:border-[var(--blue-hover)] focus:bg-[var(--card)] focus:outline-none"
        />
      </div>
      </div>

      <div className="flex flex-1 items-center justify-end gap-2">
        <button type="button" className="hidden px-2 text-sm text-[var(--muted)] hover:text-[var(--text)] xl:inline" title="Not available yet">
          Admin Center
        </button>
        <button type="button" aria-label="Notifications (none)" className={iconBtn}>
          <Bell size={18} />
        </button>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Account menu"
            className="relative grid h-9 w-9 place-items-center rounded-full bg-[var(--blue)] text-xs font-semibold text-white"
          >
            {initials(DEFAULT_USER.name)}
            <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-[var(--card)] bg-emerald-500" aria-label="Available" />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-lg">
              <div className="px-3 py-2">
                <p className="text-sm font-semibold">{DEFAULT_USER.name}</p>
                <p className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Available
                </p>
              </div>
              <hr className="my-1 border-[var(--border)]" />
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenSettings();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--hover)]"
              >
                <Gear size={14} /> Settings
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  toggleTheme();
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--hover)]"
              >
                {dark ? <Sun size={14} /> : <Moon size={14} />} {dark ? "Light mode" : "Dark mode"}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
