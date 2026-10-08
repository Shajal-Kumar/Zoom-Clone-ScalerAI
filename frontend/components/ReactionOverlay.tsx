"use client";

import { useEffect } from "react";
import { useMeeting } from "@/providers/MeetingProvider";
import type { ReactionEvent } from "@/lib/types";

const LIFETIME_MS = 4000;

function Floating({ reaction, onDone }: { reaction: ReactionEvent; onDone: (id: string) => void }) {
  // Timer is the source of truth for cleanup; animationend alone would never fire for hidden tabs.
  useEffect(() => {
    const t = setTimeout(() => onDone(reaction.id), LIFETIME_MS + 200);
    return () => clearTimeout(t);
  }, [reaction.id, onDone]);

  return (
    <div
      className="zc-float absolute bottom-2 flex flex-col items-center"
      style={{ left: `${reaction.x}%`, animationDuration: `${LIFETIME_MS}ms` }}
    >
      <span className="text-4xl drop-shadow-lg sm:text-5xl" role="img" aria-label={`Reaction ${reaction.emoji}`}>
        {reaction.emoji}
      </span>
      <span className="mt-0.5 max-w-24 truncate rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
        {reaction.sender_name}
      </span>
    </div>
  );
}

/** Emoji that rise and fade over the stage. Mount inside a `relative` container. */
export function ReactionOverlay() {
  const { reactions, dismissReaction } = useMeeting();
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-live="polite">
      <style>{`
        @keyframes zc-rise {
          0% { transform: translateY(0) scale(0.6); opacity: 0; }
          10% { opacity: 1; transform: translateY(-20px) scale(1.1); }
          100% { transform: translateY(-60vh) scale(1); opacity: 0; }
        }
        .zc-float { animation-name: zc-rise; animation-timing-function: ease-out; animation-fill-mode: forwards; }
        @media (prefers-reduced-motion: reduce) {
          .zc-float { animation-name: none; opacity: 0.9; }
        }
      `}</style>
      {reactions.map((r) => (
        <Floating key={r.id} reaction={r} onDone={dismissReaction} />
      ))}
    </div>
  );
}
