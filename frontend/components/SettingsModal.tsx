"use client";

import { Modal, inputCls } from "@/components/ui/Modal";
import { useSettings } from "@/providers/SettingsProvider";

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2">
      <span className="text-sm">{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-9 cursor-pointer appearance-none rounded-full bg-[var(--border)] transition-colors checked:bg-[var(--blue)] relative before:absolute before:left-0.5 before:top-0.5 before:h-4 before:w-4 before:rounded-full before:bg-white before:transition-transform checked:before:translate-x-4"
      />
    </label>
  );
}

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, update } = useSettings();
  return (
    <Modal open={open} onClose={onClose} title="Settings">
      <label className="mb-3 block text-sm font-medium">
        Default display name
        <input
          className={`${inputCls} mt-1 font-normal`}
          value={settings.displayName}
          maxLength={120}
          onChange={(e) => update({ displayName: e.target.value })}
        />
      </label>
      <div className="divide-y divide-[var(--border)]">
        <Toggle label="Mute microphone when joining" checked={settings.muteOnJoin} onChange={(v) => update({ muteOnJoin: v })} />
        <Toggle label="Turn camera off when joining" checked={settings.videoOffOnJoin} onChange={(v) => update({ videoOffOnJoin: v })} />
        <Toggle label="Mirror my video" checked={settings.mirrorVideo} onChange={(v) => update({ mirrorVideo: v })} />
        <Toggle label="Dark mode" checked={settings.theme === "dark"} onChange={(v) => update({ theme: v ? "dark" : "light" })} />
      </div>
      <p className="mt-4 text-xs text-[var(--muted)]">Saved in this browser.</p>
    </Modal>
  );
}
