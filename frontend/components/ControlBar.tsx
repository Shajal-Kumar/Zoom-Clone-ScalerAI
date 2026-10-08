"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  Hand,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  ShieldCheck,
  Smile,
  Users,
  Video,
  VideoOff,
} from "lucide-react";
import { Modal, secondaryBtn } from "@/components/ui/Modal";
import { useAudioLevel } from "@/hooks/useAudioLevel";
import { useDismiss } from "@/hooks/useDismiss";
import { REACTION_EMOJIS } from "@/lib/types";
import { useMeeting } from "@/providers/MeetingProvider";

export type DrawerKind = "participants" | "chat" | null;

interface ControlBarProps {
  drawer: DrawerKind;
  onToggleDrawer: (kind: Exclude<DrawerKind, null>) => void;
  unreadChat: number;
}

function CtrlButton({
  label,
  onClick,
  children,
  pressed,
  tone = "default",
  badge,
  expanded,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  pressed?: boolean;
  tone?: "default" | "danger" | "success" | "active";
  badge?: number;
  expanded?: boolean;
}) {
  const toneCls =
    tone === "danger"
      ? "text-red-400"
      : tone === "success"
        ? "text-emerald-400"
        : tone === "active"
          ? "text-[var(--blue)]"
          : "text-white";
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      className={`relative flex h-14 min-w-12 flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 text-[11px] transition-colors hover:bg-white/10 sm:min-w-16 sm:px-2 ${toneCls}`}
    >
      <span className="relative flex h-6 items-center justify-center">
        {children}
        {badge !== undefined && badge > 0 && (
          <span className="absolute -right-3 -top-1.5 min-w-4 rounded-full bg-[var(--danger)] px-1 text-center text-[10px] font-bold leading-4 text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </span>
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

export function ControlBar({ drawer, onToggleDrawer, unreadChat }: ControlBarProps) {
  const {
    meetingId,
    media,
    self,
    isHost,
    participants,
    screen,
    setHand,
    sendReaction,
    hostAction,
    leave,
  } = useMeeting();

  const level = useAudioLevel(media.stream, media.version, media.audioOn);
  const sharing = screen.local !== null;
  const handRaised = Boolean(self?.hand_raised_at);

  const [reactOpen, setReactOpen] = useState(false);
  const reactRef = useRef<HTMLDivElement>(null);
  useDismiss(reactRef, reactOpen, () => setReactOpen(false));

  const [secOpen, setSecOpen] = useState(false);
  const secRef = useRef<HTMLDivElement>(null);
  useDismiss(secRef, secOpen, () => setSecOpen(false));

  const [leaveOpen, setLeaveOpen] = useState(false);

  const popover =
    "absolute bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-xl";

  return (
    <footer className="relative z-30 flex h-16 shrink-0 items-center justify-between gap-1 border-t border-[var(--border)] bg-[#13151B] px-2 sm:px-4">
      {/* Left: devices */}
      <div className="flex items-center">
        <CtrlButton
          label={media.audioOn ? "Mute" : "Unmute"}
          onClick={media.toggleAudio}
          pressed={!media.audioOn}
          tone={media.audioOn ? "default" : "danger"}
        >
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full transition-[box-shadow]"
            style={{ boxShadow: media.audioOn ? `0 0 0 ${Math.round(level * 4)}px rgba(16,185,129,0.65)` : undefined }}
          >
            {media.audioOn ? <Mic size={20} /> : <MicOff size={20} />}
          </span>
        </CtrlButton>
        <CtrlButton
          label={media.videoOn ? "Stop Video" : "Start Video"}
          onClick={media.toggleVideo}
          pressed={!media.videoOn}
          tone={media.videoOn ? "default" : "danger"}
        >
          {media.videoOn ? <Video size={20} /> : <VideoOff size={20} />}
        </CtrlButton>
      </div>

      {/* Center: collaboration */}
      <div className="flex items-center overflow-x-auto sm:overflow-visible">
        <div ref={secRef} className="relative hidden sm:block">
          <CtrlButton label="Security" onClick={() => setSecOpen((o) => !o)} expanded={secOpen}>
            <ShieldCheck size={20} />
          </CtrlButton>
          {secOpen && (
            <div role="dialog" className={`${popover} w-64 p-3 text-xs leading-relaxed text-white`}>
              <p className="mb-1 text-sm font-semibold">Meeting info</p>
              <p className="mb-2 break-all font-mono text-[var(--muted)]">ID: {meetingId}</p>
              Rooms hold a limited number of people. Media is encrypted peer to peer by WebRTC. Only the host can mute, remove
              people, stop a screen share or end the meeting.
            </div>
          )}
        </div>
        <CtrlButton
          label="Participants"
          onClick={() => onToggleDrawer("participants")}
          tone={drawer === "participants" ? "active" : "default"}
          expanded={drawer === "participants"}
          badge={participants.length + 1}
        >
          <Users size={20} />
        </CtrlButton>
        <CtrlButton
          label="Chat"
          onClick={() => onToggleDrawer("chat")}
          tone={drawer === "chat" ? "active" : "default"}
          expanded={drawer === "chat"}
          badge={drawer === "chat" ? 0 : unreadChat}
        >
          <MessageSquare size={20} />
        </CtrlButton>
        <CtrlButton
          label={sharing ? "Stop Share" : "Share"}
          onClick={sharing ? screen.stop : screen.start}
          pressed={sharing}
          tone={sharing ? "success" : "default"}
        >
          <MonitorUp size={20} />
        </CtrlButton>
        <div ref={reactRef} className="relative">
          <CtrlButton
            label="Reactions"
            onClick={() => setReactOpen((o) => !o)}
            expanded={reactOpen}
            tone={handRaised ? "active" : "default"}
          >
            {handRaised ? <Hand size={20} /> : <Smile size={20} />}
          </CtrlButton>
          {reactOpen && (
            <div role="menu" className={`${popover} flex items-center gap-1`}>
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  role="menuitem"
                  aria-label={`Send ${emoji}`}
                  onClick={() => {
                    sendReaction(emoji);
                    setReactOpen(false);
                  }}
                  className="rounded-lg p-1.5 text-2xl transition-transform hover:scale-125 hover:bg-white/10"
                >
                  {emoji}
                </button>
              ))}
              <span className="mx-1 h-7 w-px bg-[var(--border)]" aria-hidden />
              <button
                role="menuitemcheckbox"
                aria-checked={handRaised}
                aria-label={handRaised ? "Lower hand" : "Raise hand"}
                onClick={() => {
                  setHand(!handRaised);
                  setReactOpen(false);
                }}
                className={`rounded-lg p-1.5 text-2xl transition-transform hover:scale-125 hover:bg-white/10 ${handRaised ? "bg-amber-400/30" : ""}`}
              >
                ✋
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right: leave */}
      <button
        onClick={() => (isHost ? setLeaveOpen(true) : leave())}
        className="flex h-10 items-center rounded-lg bg-[#E02828] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      >
        {isHost ? "End" : "Leave"}
      </button>

      <Modal open={leaveOpen} onClose={() => setLeaveOpen(false)} title="Leave or end the meeting?">
        <p className="mb-5 text-sm text-[var(--muted)]">
          Leaving keeps the meeting running for everyone else. Ending it disconnects all participants.
        </p>
        <div className="flex flex-col gap-2">
          <button
            className="rounded-lg bg-[#E02828] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            onClick={() => {
              setLeaveOpen(false);
              // The server closes every socket (4001); the provider then routes to /end?reason=ended.
              hostAction("end_meeting");
            }}
          >
            End Meeting for All
          </button>
          <button
            className={secondaryBtn}
            onClick={() => {
              setLeaveOpen(false);
              leave();
            }}
          >
            Leave Meeting
          </button>
          <button className={secondaryBtn} onClick={() => setLeaveOpen(false)}>
            Cancel
          </button>
        </div>
      </Modal>
    </footer>
  );
}
