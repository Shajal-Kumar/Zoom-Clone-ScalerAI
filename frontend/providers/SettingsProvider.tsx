"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_USER, STORAGE } from "@/lib/config";
import type { Settings } from "@/lib/types";

const DEFAULTS: Settings = {
  displayName: DEFAULT_USER.name,
  muteOnJoin: false,
  videoOffOnJoin: false,
  mirrorVideo: true,
  theme: "light",
};

interface Ctx {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  toggleTheme: () => void;
}

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE.settings);
      if (raw) setSettings({ ...DEFAULTS, ...JSON.parse(raw) });
    } catch {
      /* corrupt or unavailable storage: keep defaults */
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE.settings, JSON.stringify(next));
      } catch {
        /* quota / private mode */
      }
      return next;
    });
  }, []);

  const toggleTheme = useCallback(
    () => update({ theme: settings.theme === "dark" ? "light" : "dark" }),
    [settings.theme, update],
  );

  const value = useMemo(() => ({ settings, update, toggleTheme }), [settings, update, toggleTheme]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
