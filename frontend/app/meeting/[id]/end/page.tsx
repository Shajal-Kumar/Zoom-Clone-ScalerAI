"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CircleSlash, DoorOpen, Hourglass, Monitor, ShieldAlert, TriangleAlert, Users } from "lucide-react";
import { primaryBtn, secondaryBtn } from "@/components/ui/Modal";
import { isEndReason, type EndReason } from "@/lib/close-codes";
import { lobbyHref } from "@/lib/routes";
import { useMeeting } from "@/providers/MeetingProvider";

interface Copy {
  title: string;
  body: string;
  icon: React.ReactNode;
  canRejoin: boolean;
}

const COPY: Record<EndReason, Copy> = {
  left: {
    title: "You left the meeting",
    body: "You can rejoin while it is still running.",
    icon: <DoorOpen size={32} aria-hidden />,
    canRejoin: true,
  },
  ended: {
    title: "The meeting has ended",
    body: "The host ended this meeting for everyone.",
    icon: <Hourglass size={32} aria-hidden />,
    canRejoin: false,
  },
  kicked: {
    title: "You were removed",
    body: "The host removed you from this meeting.",
    icon: <ShieldAlert size={32} aria-hidden />,
    canRejoin: false,
  },
  notfound: {
    title: "Meeting not found",
    body: "This meeting doesn't exist or has already ended.",
    icon: <CircleSlash size={32} aria-hidden />,
    canRejoin: false,
  },
  full: {
    title: "This meeting is full",
    body: "No more participants can join right now. Try again in a moment.",
    icon: <Users size={32} aria-hidden />,
    canRejoin: true,
  },
  replaced: {
    title: "Joined from another window",
    body: "You opened this meeting in another tab or window, so this one was disconnected. Rejoin here to use this window instead.",
    icon: <Monitor size={32} aria-hidden />,
    canRejoin: true,
  },
  error: {
    title: "Something went wrong",
    body: "We couldn't keep you connected to this meeting.",
    icon: <TriangleAlert size={32} aria-hidden />,
    canRejoin: true,
  },
};

function EndView() {
  const search = useSearchParams();
  const { meetingId, shutdown } = useMeeting();
  const raw = search.get("reason");
  const reason: EndReason = isEndReason(raw) ? raw : "left";
  const copy = COPY[reason];

  // Typed URL or browser Back into /end: make sure the camera light is off and the socket is closed.
  useEffect(() => {
    shutdown();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--hover)] text-[var(--muted)]">
          {copy.icon}
        </div>
        <h1 className="text-xl font-semibold">{copy.title}</h1>
        <p className="text-sm text-[var(--muted)]">{copy.body}</p>
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          {copy.canRejoin && (
            <Link href={lobbyHref(meetingId)} className={primaryBtn}>
              Rejoin
            </Link>
          )}
          <Link href="/" className={copy.canRejoin ? secondaryBtn : primaryBtn}>
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function EndPage() {
  return (
    <Suspense fallback={null}>
      <EndView />
    </Suspense>
  );
}
