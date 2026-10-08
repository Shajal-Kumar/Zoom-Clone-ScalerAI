"use client";

import { Modal, primaryBtn, secondaryBtn } from "@/components/ui/Modal";
import type { ShareConflict } from "@/hooks/useScreenShare";

interface ReplaceShareDialogProps {
  conflict: ShareConflict | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** "Replace current share?" shown after the server answers share_in_progress (A6). */
export function ReplaceShareDialog({ conflict, onConfirm, onCancel }: ReplaceShareDialogProps) {
  return (
    <Modal open={conflict !== null} onClose={onCancel} title="Replace current share?">
      <p className="text-sm text-[var(--muted)]">
        {conflict?.sharerName ?? "Someone"} is already sharing their screen. Only one person can share at a
        time. If you continue, their share will stop and yours will start.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button className={secondaryBtn} onClick={onCancel}>
          Cancel
        </button>
        <button className={primaryBtn} onClick={onConfirm}>
          Replace share
        </button>
      </div>
    </Modal>
  );
}
