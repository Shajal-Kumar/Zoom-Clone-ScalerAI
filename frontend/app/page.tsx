"use client";

import { useState } from "react";
import { mutate } from "swr";
import { ActionCards } from "@/components/ActionCards";
import { CalendarFeed } from "@/components/CalendarFeed";
import { ClockWidget } from "@/components/ClockWidget";
import { JoinModal } from "@/components/JoinModal";
import { ScheduleConfirmModal } from "@/components/ScheduleConfirmModal";
import { ScheduleModal } from "@/components/ScheduleModal";
import { useToast } from "@/components/ui/useToast";
import { swrKeys } from "@/lib/api";
import type { Meeting } from "@/lib/types";

// Navbar / Sidebar now live in <AppShell> (app/layout.tsx), so this page is content only.
export default function Dashboard() {
  const [join, setJoin] = useState<"join" | "share" | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduled, setScheduled] = useState<Meeting | null>(null);
  const { show: showToast, node: toast } = useToast();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <ClockWidget />
      <ActionCards
        onJoin={() => setJoin("join")}
        onShare={() => setJoin("share")}
        onSchedule={() => setScheduleOpen(true)}
        onToast={showToast}
      />
      <CalendarFeed />

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
      {toast}
    </div>
  );
}
