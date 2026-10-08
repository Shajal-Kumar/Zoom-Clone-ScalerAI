"use client";

import { useState } from "react";
import { Crown, Hand, Mic, MicOff, MoreVertical, MonitorOff, UserX, Video, VideoOff, X } from "lucide-react";
import { Modal, primaryBtn, secondaryBtn } from "@/components/ui/Modal";
import type { PeerInfo } from "@/lib/types";
import { useMeeting } from "@/providers/MeetingProvider";

function Row({
  peer,
  isSelf,
  canManage,
  open,
  onToggle,
  onMute,
  onStopShare,
  onRemove,
}: {
  peer: PeerInfo;
  isSelf: boolean;
  canManage: boolean;
  open: boolean;
  onToggle: () => void;
  onMute: () => void;
  onStopShare: () => void;
  onRemove: () => void;
}) {
  const menuItem = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/10";
  return (
    <li className="rounded-lg px-2 py-1.5 hover:bg-white/5">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--blue)] text-xs font-semibold text-white">
          {peer.display_name.slice(0, 1).toUpperCase() || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {peer.display_name}
            {isSelf && <span className="text-[var(--muted)]"> (You)</span>}
          </p>
          <p className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
            {peer.is_host ? <Crown size={11} className="text-amber-300" aria-hidden /> : null}
            {peer.is_host ? "Host" : "Guest"}
            {peer.is_sharing && " · Sharing"}
          </p>
        </div>
        {peer.hand_raised_at && (
          <Hand size={15} className="text-amber-300" aria-label="Hand raised" />
        )}
        {peer.audio ? (
          <Mic size={15} className="text-[var(--muted)]" aria-label="Microphone on" />
        ) : (
          <MicOff size={15} className="text-red-400" aria-label="Muted" />
        )}
        {peer.video ? (
          <Video size={15} className="text-[var(--muted)]" aria-label="Camera on" />
        ) : (
          <VideoOff size={15} className="text-red-400" aria-label="Camera off" />
        )}
        {canManage && (
          <button
            onClick={onToggle}
            aria-expanded={open}
            aria-label={`Actions for ${peer.display_name}`}
            className="rounded-md p-1 text-[var(--muted)] hover:bg-white/10"
          >
            <MoreVertical size={16} />
          </button>
        )}
      </div>
      {canManage && open && (
        <div className="ml-10 mt-1 space-y-0.5 rounded-md border border-[var(--border)] bg-[var(--bg)] p-1">
          <button className={menuItem} onClick={onMute} disabled={!peer.audio}>
            <MicOff size={14} aria-hidden /> Mute
          </button>
          {peer.is_sharing && (
            <button className={menuItem} onClick={onStopShare}>
              <MonitorOff size={14} aria-hidden /> Stop Screen Share
            </button>
          )}
          <button className={`${menuItem} text-red-400`} onClick={onRemove}>
            <UserX size={14} aria-hidden /> Remove Participant
          </button>
        </div>
      )}
    </li>
  );
}

export function ParticipantsDrawer({ onClose }: { onClose: () => void }) {
  const { self, selfId, participants, isHost, hostAction, notify } = useMeeting();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [removing, setRemoving] = useState<PeerInfo | null>(null);

  const total = participants.length + (self ? 1 : 0);
  const anyUnmuted = participants.some((p) => p.audio && !p.is_host);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-semibold">Participants ({total})</h2>
        <button onClick={onClose} aria-label="Close participants" className="rounded-md p-1 text-[var(--muted)] hover:bg-white/10">
          <X size={18} />
        </button>
      </div>

      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        {self && (
          <Row
            peer={self}
            isSelf
            canManage={false}
            open={false}
            onToggle={() => {}}
            onMute={() => {}}
            onStopShare={() => {}}
            onRemove={() => {}}
          />
        )}
        {participants.map((p) => (
          <Row
            key={p.client_id}
            peer={p}
            isSelf={p.client_id === selfId}
            canManage={isHost && !p.is_host}
            open={menuFor === p.client_id}
            onToggle={() => setMenuFor((cur) => (cur === p.client_id ? null : p.client_id))}
            onMute={() => {
              hostAction("mute", p.client_id);
              setMenuFor(null);
            }}
            onStopShare={() => {
              hostAction("stop_share", p.client_id);
              setMenuFor(null);
            }}
            onRemove={() => {
              setRemoving(p);
              setMenuFor(null);
            }}
          />
        ))}
      </ul>

      {isHost && (
        <div className="border-t border-[var(--border)] p-3">
          <button
            className={`${secondaryBtn} w-full`}
            disabled={!anyUnmuted}
            onClick={() => {
              hostAction("mute_all");
              notify("Muted everyone. They can unmute themselves.");
            }}
          >
            <MicOff size={16} aria-hidden /> Mute All
          </button>
        </div>
      )}

      <Modal open={removing !== null} onClose={() => setRemoving(null)} title="Remove participant?">
        <p className="mb-5 text-sm text-[var(--muted)]">
          {removing?.display_name} will be removed and won&apos;t be able to rejoin this meeting.
        </p>
        <div className="flex justify-end gap-2">
          <button className={secondaryBtn} onClick={() => setRemoving(null)}>
            Cancel
          </button>
          <button
            className={`${primaryBtn} !bg-[var(--danger)]`}
            onClick={() => {
              if (removing) hostAction("kick", removing.client_id);
              setRemoving(null);
            }}
          >
            Remove
          </button>
        </div>
      </Modal>
    </div>
  );
}
