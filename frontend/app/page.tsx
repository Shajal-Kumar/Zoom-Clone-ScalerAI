"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mutate } from "swr";
import { ActionCards } from "@/components/ActionCards";
import { ClockWidget } from "@/components/ClockWidget";
import { JoinModal } from "@/components/JoinModal";
import { MeetingList } from "@/components/MeetingList";
import { Navbar, type NavTarget } from "@/components/Navbar";
import { ScheduleConfirmModal } from "@/components/ScheduleConfirmModal";
import { ScheduleModal } from "@/components/ScheduleModal";
import { swrKeys } from "@/lib/api";
import type { Meeting } from "@/lib/types";

export default function Dashboard() {
  const [join, setJoin] = useState<"join" | "share" | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduled, setScheduled] = useState<Meeting | null>(null);
  const [nav, setNav] = useState<NavTarget>("home");
  const [toast, setToast] = useState<string | null>(null);
  const listRef = useRef<HTMLElement>(null);

  const showToast = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  function navigate(target: NavTarget) {
    setNav(target);
    if (target === "meetings") listRef.current?.scrollIntoView({ behavior: "smooth" });
    else window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="min-h-screen">
      <Navbar active={nav} onNavigate={navigate} />
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <ActionCards
            onJoin={() => setJoin("join")}
            onShare={() => setJoin("share")}
            onSchedule={() => setScheduleOpen(true)}
            onToast={showToast}
          />
          <ClockWidget />
        </div>
        <MeetingList ref={listRef} onToast={showToast} />
      </main>

      <JoinModal open={join !== null} intent={join ?? "join"} onClose={() => setJoin(null)} />
      <ScheduleModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onCreated={(meeting) => {
          setScheduleOpen(false);
          setScheduled(meeting);
          void mutate(swrKeys.upcoming);
        }}
      />
      <ScheduleConfirmModal meeting={scheduled} onClose={() => setScheduled(null)} onToast={showToast} />

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-[#13151B] px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
