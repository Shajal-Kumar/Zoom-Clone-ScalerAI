"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { primaryBtn, inputCls } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { storePasscode } from "@/lib/storage";

interface PasscodeGateProps {
  meetingId: string;
  /** Shown above the field, e.g. after the socket closed with 4005. */
  notice?: string | null;
  onVerified: (passcode: string) => void;
}

/** Guests of a protected meeting must pass this before the lobby unlocks (host bypasses, A3). */
export function PasscodeGate({ meetingId, notice, onVerified }: PasscodeGateProps) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.verifyPasscode(meetingId, value);
      if (res.valid) {
        storePasscode(meetingId, value);
        onVerified(value);
      } else if (res.reason === "ended") {
        setError("This meeting has ended.");
      } else if (res.reason === "not_found") {
        setError("Meeting not found.");
      } else {
        setError("That passcode is incorrect. Check it and try again.");
      }
    } catch (err) {
      // Includes the 429 "Too many incorrect passcodes" detail from the backend.
      setError(err instanceof Error ? err.message : "Couldn't verify the passcode.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-sm space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
      <div className="flex items-center gap-2 text-lg font-semibold">
        <Lock size={18} aria-hidden /> Enter meeting passcode
      </div>
      {notice && <p className="text-sm text-[var(--danger)]">{notice}</p>}
      <div>
        <label htmlFor="passcode" className="mb-1 block text-xs font-medium text-[var(--muted)]">
          Passcode
        </label>
        <input
          id="passcode"
          className={inputCls}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={64}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      <button type="submit" className={`${primaryBtn} w-full`} disabled={busy || !code.trim()}>
        {busy ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
