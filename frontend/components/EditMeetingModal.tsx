"use client";

import { useCallback, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Meeting, UpdateMeetingRequest } from "@/lib/types";
import { Modal, inputCls, primaryBtn, secondaryBtn } from "./ui/Modal";

interface Props {
  meeting: Meeting;
  onClose: () => void;
  onSaved: (meeting: Meeting) => void;
}

const PASSCODE_RE = /^[A-Za-z0-9]{4,16}$/; // mirrors the backend rule (4-16 alphanumerics)
const pad = (n: number) => String(n).padStart(2, "0");

/** ISO string -> value for <input type="datetime-local"> in the user's local time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Render this only while it should be open (`{open && <EditMeetingModal key={meeting.id} .../>}`):
 * form state is initialised from `meeting` on mount, so every open starts pre-filled and fresh.
 * `onClose` should be a stable reference (useCallback) so the Modal doesn't steal focus on re-render.
 */
export function EditMeetingModal({ meeting, onClose, onSaved }: Props) {
  const uid = useId();
  const [initialStart] = useState(() => toLocalInput(meeting.scheduled_start));
  const [title, setTitle] = useState(meeting.title);
  const [passcode, setPasscode] = useState(meeting.passcode ?? "");
  const [start, setStart] = useState(initialStart);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false); // lets Esc/backdrop close be ignored mid-request without changing `close`'s identity

  const close = useCallback(() => {
    if (!savingRef.current) onClose();
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (savingRef.current) return;

    const nextTitle = title.trim();
    const nextPasscode = passcode.trim();
    if (!nextTitle) return setError("Enter a meeting title.");
    if (!PASSCODE_RE.test(nextPasscode)) return setError("Passcode must be 4-16 letters or numbers.");

    // PATCH only what changed.
    const payload: UpdateMeetingRequest = {};
    if (nextTitle !== meeting.title) payload.title = nextTitle;
    if (nextPasscode.toUpperCase() !== (meeting.passcode ?? "").toUpperCase()) payload.passcode = nextPasscode;
    if (start !== initialStart) {
      const when = new Date(start);
      if (!start || Number.isNaN(when.getTime())) return setError("Choose a valid start time.");
      if (when.getTime() <= Date.now()) return setError("Start time must be in the future.");
      payload.scheduled_start = when.toISOString();
    }
    if (Object.keys(payload).length === 0) return onClose(); // nothing changed

    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateMeeting(meeting.id, payload);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save changes.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const label = "mb-1 block text-sm font-medium";

  return (
    <Modal open onClose={close} title="Edit meeting">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg border border-[var(--danger)] px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </div>
        )}

        <div>
          <label htmlFor={`${uid}-title`} className={label}>Title</label>
          <input
            id={`${uid}-title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            disabled={saving}
            className={inputCls}
          />
        </div>

        <div>
          <label htmlFor={`${uid}-passcode`} className={label}>Passcode</label>
          <input
            id={`${uid}-passcode`}
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            maxLength={16}
            autoComplete="off"
            spellCheck={false}
            disabled={saving}
            className={inputCls}
          />
          <p className="mt-1 text-xs text-[var(--muted)]">4-16 letters or numbers.</p>
        </div>

        <div>
          <label htmlFor={`${uid}-start`} className={label}>Start time</label>
          <input
            id={`${uid}-start`}
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            disabled={saving}
            className={inputCls}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={close} disabled={saving} className={secondaryBtn}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={primaryBtn}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
