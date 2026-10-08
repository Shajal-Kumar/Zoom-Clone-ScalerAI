"use client";

import { Check, Copy, Link2 } from "lucide-react";
import { formatMeetingId } from "@/lib/ids";
import { buildInvitation, copyText, formatWhen, meetingLink } from "@/lib/invite";
import type { Meeting } from "@/lib/types";
import { Modal, primaryBtn, secondaryBtn } from "./ui/Modal";

interface Props {
  meeting: Meeting | null;
  onClose: () => void;
  onToast: (message: string) => void;
}

export function ScheduleConfirmModal({ meeting, onClose, onToast }: Props) {
  async function copy(text: string, done: string) {
    onToast((await copyText(text)) ? done : "Couldn't copy. Select the text and copy it manually.");
  }

  return (
    <Modal open={!!meeting} onClose={onClose} title="Meeting scheduled" widthClass="max-w-lg">
      {meeting && (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm text-emerald-600">
            <Check size={16} /> Added to your upcoming meetings.
          </p>
          <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
            <dt className="text-[var(--muted)]">Topic</dt><dd className="font-medium">{meeting.title}</dd>
            <dt className="text-[var(--muted)]">When</dt>
            <dd className="font-medium">{formatWhen(meeting.scheduled_start, { dateStyle: "full", timeStyle: "short" })}</dd>
            <dt className="text-[var(--muted)]">Meeting ID</dt><dd className="font-medium tabular-nums">{formatMeetingId(meeting.id)}</dd>
            <dt className="text-[var(--muted)]">Passcode</dt><dd className="font-medium">{meeting.passcode}</dd>
          </dl>
          <textarea
            readOnly
            aria-label="Invitation preview"
            rows={8}
            value={buildInvitation(meeting)}
            className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <button onClick={() => copy(meetingLink(meeting.id), "Invite link copied")} className={secondaryBtn}>
              <Link2 size={14} /> Copy link
            </button>
            <button onClick={() => copy(buildInvitation(meeting), "Invitation copied")} className={secondaryBtn}>
              <Copy size={14} /> Copy invitation
            </button>
            <button onClick={onClose} className={primaryBtn}>Done</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
