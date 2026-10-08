"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Meeting } from "@/lib/types";
import { Modal, inputCls, primaryBtn, secondaryBtn } from "./ui/Modal";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (meeting: Meeting) => void;
}

const pad = (n: number) => String(n).padStart(2, "0");
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function nextHalfHour(): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  return d;
}

interface Form {
  title: string;
  description: string;
  date: string;
  time: string;
  duration: string;
  passcode: string;
}

const initialForm = (): Form => {
  const start = nextHalfHour();
  return { title: "", description: "", date: toDateInput(start), time: toTimeInput(start), duration: "30", passcode: "" };
};

type Errors = Partial<Record<keyof Form, string>>;

function validate(f: Form): { errors: Errors; startISO?: string; minutes?: number } {
  const errors: Errors = {};
  if (!f.title.trim()) errors.title = "Add a topic for the meeting.";
  const start = new Date(`${f.date}T${f.time}`); // parsed as local time
  if (!f.date || !f.time || Number.isNaN(start.getTime())) errors.date = "Pick a start date and time.";
  else if (start.getTime() <= Date.now()) errors.date = "Start time must be in the future.";
  const minutes = Number(f.duration);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) errors.duration = "Enter 1 to 1440 minutes.";
  if (f.passcode && !/^[A-Za-z0-9]{4,16}$/.test(f.passcode)) errors.passcode = "Use 4 to 16 letters or numbers.";
  return { errors, startISO: errors.date ? undefined : start.toISOString(), minutes };
}

export function ScheduleModal({ open, onClose, onCreated }: Props) {
  const [form, setForm] = useState<Form>(initialForm);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initialForm());
      setErrors({});
      setServerError(null);
      setBusy(false);
    }
  }, [open]);

  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { errors: found, startISO, minutes } = validate(form);
    setErrors(found);
    if (Object.keys(found).length || !startISO || !minutes) return;

    setBusy(true);
    setServerError(null);
    try {
      const meeting = await api.schedule({
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        scheduled_start: startISO,
        duration_minutes: minutes,
        passcode: form.passcode || undefined,
      });
      onCreated(meeting);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Couldn't schedule the meeting.");
    } finally {
      setBusy(false);
    }
  }

  const err = (k: keyof Form) => errors[k] && <p className="mt-1 text-xs text-[var(--danger)]">{errors[k]}</p>;

  return (
    <Modal open={open} onClose={onClose} title="Schedule meeting" widthClass="max-w-lg">
      <form onSubmit={submit} noValidate className="space-y-4">
        <label className="block text-sm font-medium">
          Topic
          <input className={`${inputCls} mt-1 font-normal`} value={form.title} maxLength={200} onChange={set("title")} placeholder="Weekly sync" aria-invalid={!!errors.title} />
          {err("title")}
        </label>
        <label className="block text-sm font-medium">
          Description <span className="font-normal text-[var(--muted)]">(optional)</span>
          <textarea className={`${inputCls} mt-1 font-normal`} rows={2} maxLength={2000} value={form.description} onChange={set("description")} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            Date
            <input type="date" className={`${inputCls} mt-1 font-normal`} value={form.date} min={toDateInput(new Date())} onChange={set("date")} aria-invalid={!!errors.date} />
          </label>
          <label className="block text-sm font-medium">
            Time
            <input type="time" className={`${inputCls} mt-1 font-normal`} value={form.time} onChange={set("time")} aria-invalid={!!errors.date} />
          </label>
        </div>
        {err("date")}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            Duration (minutes)
            <input type="number" inputMode="numeric" min={1} max={1440} className={`${inputCls} mt-1 font-normal`} value={form.duration} onChange={set("duration")} aria-invalid={!!errors.duration} />
            {err("duration")}
          </label>
          <label className="block text-sm font-medium">
            Passcode <span className="font-normal text-[var(--muted)]">(optional)</span>
            <input className={`${inputCls} mt-1 font-normal`} value={form.passcode} maxLength={16} onChange={set("passcode")} placeholder="Auto-generated" autoComplete="off" aria-invalid={!!errors.passcode} />
            {err("passcode")}
          </label>
        </div>
        {serverError && <p role="alert" className="text-sm text-[var(--danger)]">{serverError}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
          <button type="submit" disabled={busy} className={primaryBtn}>
            {busy && <Loader2 size={14} className="animate-spin" />} Schedule
          </button>
        </div>
      </form>
    </Modal>
  );
}
