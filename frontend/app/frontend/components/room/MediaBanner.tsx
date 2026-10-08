"use client";

import { AlertTriangle } from "lucide-react";
import { describeMediaIssue, type MediaIssue } from "@/hooks/useLocalMedia";

interface MediaBannerProps {
  audioIssue: MediaIssue | null;
  videoIssue: MediaIssue | null;
  onRetry: () => void;
}

/** Persistent top banner for denied / missing / busy devices. Never blocks joining (5.4). */
export function MediaBanner({ audioIssue, videoIssue, onRetry }: MediaBannerProps) {
  if (!audioIssue && !videoIssue) return null;
  const messages = [
    videoIssue ? describeMediaIssue("Camera", videoIssue) : null,
    audioIssue ? describeMediaIssue("Microphone", audioIssue) : null,
  ].filter((m): m is string => m !== null);

  return (
    <div
      role="alert"
      className="flex items-start gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2.5 text-sm text-[var(--text)]"
    >
      <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        {messages.map((m) => (
          <p key={m}>{m}</p>
        ))}
      </div>
      <button
        onClick={onRetry}
        className="shrink-0 rounded-md border border-amber-500/60 px-3 py-1 text-xs font-semibold hover:bg-amber-500/20"
      >
        Retry
      </button>
    </div>
  );
}
