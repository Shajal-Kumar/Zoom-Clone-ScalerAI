"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Navbar } from "./Navbar";
import { SettingsModal } from "./SettingsModal";
import { Sidebar } from "./Sidebar";

/**
 * Global chrome (top bar + left rail). Kept out of app/layout.tsx so the root layout can stay a
 * server component with `metadata`. Meeting routes (/meeting/...) render full-screen with no chrome.
 * Note: "/meetings" (the dashboard list) does NOT match "/meeting/".
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (pathname?.startsWith("/meeting/")) return <>{children}</>;

  return (
    <div className="flex h-screen flex-col bg-[var(--bg)]">
      <Navbar onOpenSettings={() => setSettingsOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
        <main className="mb-2 mr-2 min-w-0 flex-1 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)]">
          {children}
        </main>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
