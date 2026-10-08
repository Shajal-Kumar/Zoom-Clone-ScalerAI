"use client";

import { useEffect, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { useMeeting } from "@/providers/MeetingProvider";

function time(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatDrawer({ onClose }: { onClose: () => void }) {
  const { chat, selfId, sendChat, notify } = useMeeting();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [chat.length]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    if (sendChat(text)) setText("");
    else notify("Message not sent. Check your connection.");
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-semibold">Chat</h2>
        <button onClick={onClose} aria-label="Close chat" className="rounded-md p-1 text-[var(--muted)] hover:bg-white/10">
          <X size={18} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" role="log" aria-live="polite">
        {chat.length === 0 && <p className="pt-6 text-center text-sm text-[var(--muted)]">No messages yet. Say hello!</p>}
        {chat.map((m) => {
          const mine = m.sender_id === selfId;
          return (
            <div key={m.id} className="text-sm">
              <div className="flex items-baseline gap-2">
                <span className={`font-semibold ${mine ? "text-[var(--blue)]" : ""}`}>{mine ? "You" : m.sender_name}</span>
                {m.is_host && <span className="text-[10px] font-semibold text-amber-300">Host</span>}
                <span className="text-[11px] text-[var(--muted)]">{time(m.ts)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words">{m.text}</p>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="border-t border-[var(--border)] p-3">
        <p className="mb-1.5 text-[11px] text-[var(--muted)]">To: Everyone</p>
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            placeholder="Type a message"
            aria-label="Message"
            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm placeholder:text-[var(--muted)] focus:border-[var(--blue)]"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            aria-label="Send message"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--blue)] text-white hover:bg-[var(--blue-hover)] disabled:opacity-50"
          >
            <Send size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
