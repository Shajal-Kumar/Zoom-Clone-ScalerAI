"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { CalendarPlus, Copy, Loader2, Pencil, RefreshCw } from "lucide-react";
import { EditMeetingModal } from "@/components/EditMeetingModal";
import { primaryBtn, secondaryBtn } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/useToast";
import { api, swrKeys } from "@/lib/api";
import { DEFAULT_USER } from "@/lib/config";
import { formatMeetingId } from "@/lib/ids";
import { buildInvitation, copyText, formatWhen } from "@/lib/invite";
import type { Meeting } from "@/lib/types";

// Placeholder: the backend has no personal-meeting-room concept. "Start" creates a fresh instant meeting.
const PMI_ID = "915 000 7637";
const PMI_TITLE = "My Personal Meeting ID (PMI)";
const PMI = "pmi";

export default function MeetingsPage() {
  const router = useRouter();
  const { show: toast, node: toastNode } = useToast();
  const { data, error, mutate, isValidating } = useSWR(swrKeys.upcoming, api.list, { refreshInterval: 15000 });

  const [selected, setSelected] = useState<string>(PMI);
  const [showInvite, setShowInvite] = useState(false);
  const [starting, setStarting] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const closeEdit = useCallback(() => setIsEditModalOpen(false), []);
  const handleSaved = useCallback(
    (updated: Meeting) => {
      // Update the cached list immediately (left + right panes both read from it), then revalidate.
      void mutate((current) => current?.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)), { revalidate: true });
      setIsEditModalOpen(false);
      toast("Meeting updated");
    },
    [mutate, toast],
  );

  const meeting = selected === PMI ? undefined : data?.find((m) => m.id === selected);
  const isPmi = selected === PMI || !meeting; // fall back to PMI if the selected meeting disappeared

  async function startPmi() {
    if (starting) return;
    setStarting(true);
    try {
      const m = await api.createInstant("Personal Meeting Room");
      router.push(`/meeting/${m.id}/lobby?as=host`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't start a meeting.");
      setStarting(false);
    }
  }

  const invitationText = isPmi
    ? `${DEFAULT_USER.name} is inviting you to a Zoom Clone meeting.\n\nTopic: ${PMI_TITLE}\nMeeting ID: ${PMI_ID}`
    : buildInvitation(meeting!);

  async function copyInvitation() {
    toast((await copyText(invitationText)) ? "Invitation copied" : "Couldn't copy. Select the text and copy it manually.");
  }

  function select(id: string) {
    setSelected(id);
    setShowInvite(false);
  }

  const itemCls = (active: boolean) =>
    `w-full rounded-xl px-4 py-3 text-center transition-colors ${
      active ? "bg-[var(--blue)] text-white" : "border border-[var(--border)] hover:bg-[var(--hover)]"
    }`;

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Left pane */}
      <section aria-label="Upcoming meetings" className="flex max-h-72 shrink-0 flex-col border-b border-[var(--border)] md:max-h-none md:w-[30%] md:min-w-64 md:border-b-0 md:border-r">
        <div className="relative flex items-center justify-center px-3 py-3">
          <button
            type="button"
            onClick={() => void mutate()}
            aria-label="Refresh"
            className="absolute left-3 grid h-7 w-7 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--hover)]"
          >
            <RefreshCw size={14} className={isValidating ? "animate-spin" : ""} />
          </button>
          <h2 className="text-sm font-semibold">Upcoming</h2>
        </div>

        <ul className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
          <li>
            <button type="button" onClick={() => select(PMI)} aria-current={isPmi} className={itemCls(isPmi)}>
              <span className="block text-lg font-bold tabular-nums">{PMI_ID}</span>
              <span className="block text-xs opacity-90">{PMI_TITLE}</span>
            </button>
          </li>
          {error ? (
            <li role="alert" className="p-3 text-center text-sm text-[var(--muted)]">
              {error instanceof Error ? error.message : "Couldn't load meetings."}
            </li>
          ) : !data ? (
            [0, 1].map((i) => <li key={i} aria-hidden className="h-16 animate-pulse rounded-xl bg-[var(--hover)]" />)
          ) : data.length === 0 ? (
            <li className="p-6 text-center text-sm text-[var(--muted)]">No upcoming meetings</li>
          ) : (
            data.map((m) => {
              const active = !isPmi && m.id === meeting?.id;
              return (
                <li key={m.id}>
                  <button type="button" onClick={() => select(m.id)} aria-current={active} className={itemCls(active)}>
                    <span className="block truncate text-sm font-semibold">{m.title}</span>
                    <span className="block text-xs opacity-80">{formatWhen(m.scheduled_start ?? m.created_at)}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="border-t border-[var(--border)] py-3 text-center">
          <button
            type="button"
            onClick={() => toast("Calendar connections aren't available yet.")}
            className="inline-flex items-center gap-1.5 text-sm text-[var(--blue)] hover:underline"
          >
            <CalendarPlus size={14} /> Add a calendar
          </button>
        </div>
      </section>

      {/* Right pane */}
      <section aria-label="Meeting details" className="min-w-0 flex-1 overflow-y-auto p-6 md:p-10">
        <h1 className="text-2xl font-semibold">{isPmi ? PMI_TITLE : meeting!.title}</h1>

        {isPmi ? (
          <p className="mt-6 text-sm tabular-nums">{PMI_ID}</p>
        ) : (
          <dl className="mt-6 space-y-1 text-sm">
            <div className="flex gap-2"><dt className="w-24 text-[var(--muted)]">When</dt><dd>{formatWhen(meeting!.scheduled_start ?? meeting!.created_at)}</dd></div>
            <div className="flex gap-2"><dt className="w-24 text-[var(--muted)]">Meeting ID</dt><dd className="tabular-nums">{formatMeetingId(meeting!.id)}</dd></div>
            <div className="flex gap-2"><dt className="w-24 text-[var(--muted)]">Host</dt><dd>{meeting!.host?.name ?? "Unknown"}</dd></div>
            {meeting!.passcode && (
              <div className="flex gap-2"><dt className="w-24 text-[var(--muted)]">Passcode</dt><dd>{meeting!.passcode}</dd></div>
            )}
          </dl>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {isPmi ? (
            <button type="button" onClick={startPmi} disabled={starting} className={`${primaryBtn} disabled:opacity-70`}>
              {starting && <Loader2 size={14} className="animate-spin" />} Start
            </button>
          ) : (
            <Link href={`/meeting/${meeting!.id}/lobby?as=host`} className={primaryBtn}>Start</Link>
          )}
          <button type="button" onClick={copyInvitation} className={secondaryBtn}>
            <Copy size={14} /> Copy Invitation
          </button>
          <button type="button" onClick={() => (isPmi ? toast("The personal meeting room can't be edited yet.") : setIsEditModalOpen(true))} className={secondaryBtn}>
            <Pencil size={14} /> Edit
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowInvite((v) => !v)}
          aria-expanded={showInvite}
          className="mt-8 text-sm text-[var(--blue)] hover:underline"
        >
          {showInvite ? "Hide" : "Show"} Meeting Invitation
        </button>
        {showInvite && (
          <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 font-sans text-sm">{invitationText}</pre>
        )}
      </section>
      {isEditModalOpen && meeting && (
        <EditMeetingModal key={meeting.id} meeting={meeting} onClose={closeEdit} onSaved={handleSaved} />
      )}
      {toastNode}
    </div>
  );
}
