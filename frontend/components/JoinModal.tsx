"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { STORAGE } from "@/lib/config";
import { normalizeMeetingId } from "@/lib/ids";
import { useSettings } from "@/providers/SettingsProvider";
import { Modal, inputCls, primaryBtn, secondaryBtn } from "./ui/Modal";

interface Props {
  open: boolean;
  /** "share" is opened from the Share screen tile; the lobby/room shows the share CTA. */
  intent: "join" | "share";
  onClose: () => void;
}

export function JoinModal({ open, intent, onClose }: Props) {
  const router = useRouter();
  const { settings } = useSettings();
  const [meetingId, setMeetingId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(settings.displayName);
      setError(null);
      setBusy(false);
    }
  }, [open, settings.displayName]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = normalizeMeetingId(meetingId);
    if (!id) return setError("Enter the 11-digit meeting ID, for example 849 2049 1029.");
    const displayName = name.trim();
    if (!displayName) return setError("Enter the name others will see.");

    setBusy(true);
    setError(null);
    try {
      const res = await api.lookup(id);
      if (!res.exists || !res.meeting) return setError("Meeting not found. Check the ID and try again.");
      if (res.meeting.status === "ended") return setError("This meeting has ended.");
      sessionStorage.setItem(STORAGE.pendingName, displayName);
      onClose();
      router.push(`/meeting/${id}/lobby${intent === "share" ? "?intent=share" : ""}`); // guest: no ?as=host
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={intent === "share" ? "Join to share your screen" : "Join meeting"}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <label className="block text-sm font-medium">
          Meeting ID
          <input
            className={`${inputCls} mt-1 font-normal tabular-nums`}
            inputMode="numeric"
            autoComplete="off"
            placeholder="849 2049 1029"
            value={meetingId}
            onChange={(e) => setMeetingId(e.target.value)}
            maxLength={20}
            aria-invalid={!!error}
          />
        </label>
        <label className="block text-sm font-medium">
          Your name
          <input className={`${inputCls} mt-1 font-normal`} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </label>
        {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
          <button type="submit" disabled={busy} className={primaryBtn}>
            {busy && <Loader2 size={14} className="animate-spin" />} Join
          </button>
        </div>
      </form>
    </Modal>
  );
}
