/** Application close codes, mirrored from backend/websocket_manager.py (CloseCode). */
export const CloseCode = {
  GOING_AWAY: 1001,
  INTERNAL_ERROR: 1011,
  MEETING_ENDED: 4001,
  REMOVED_BY_HOST: 4003,
  NOT_FOUND: 4004,
  PASSCODE: 4005,
  ROOM_FULL: 4008,
  REPLACED: 4009,
  IDLE_TIMEOUT: 4010,
  BAD_REQUEST: 4400,
} as const;

/** `?reason=` values understood by /meeting/[id]/end. */
export type EndReason = "left" | "ended" | "kicked" | "notfound" | "full" | "replaced" | "error";

export const END_REASONS: readonly EndReason[] = [
  "left",
  "ended",
  "kicked",
  "notfound",
  "full",
  "replaced",
  "error",
];

export function isEndReason(value: string | null): value is EndReason {
  return value !== null && (END_REASONS as readonly string[]).includes(value);
}

export type CloseOutcome =
  | { kind: "reconnect" }
  | { kind: "passcode" }
  | { kind: "end"; reason: EndReason };

/**
 * What the client does with a WebSocket close code (HANDOFF 3.6).
 * Anything that is not an application code (1000, 1001, 1005, 1006, 1011, 4010...) is
 * treated as transient and retried with backoff.
 */
export function classifyClose(code: number): CloseOutcome {
  switch (code) {
    case CloseCode.MEETING_ENDED:
      return { kind: "end", reason: "ended" };
    case CloseCode.REMOVED_BY_HOST:
      return { kind: "end", reason: "kicked" };
    case CloseCode.NOT_FOUND:
      return { kind: "end", reason: "notfound" };
    case CloseCode.PASSCODE:
      return { kind: "passcode" };
    case CloseCode.ROOM_FULL:
      return { kind: "end", reason: "full" };
    case CloseCode.REPLACED:
      return { kind: "end", reason: "replaced" };
    case CloseCode.BAD_REQUEST:
      return { kind: "end", reason: "error" };
    case CloseCode.IDLE_TIMEOUT:
      return { kind: "reconnect" };
    default:
      // Unknown private-use codes are not something retrying will fix.
      return code >= 4000 && code <= 4999 ? { kind: "end", reason: "error" } : { kind: "reconnect" };
  }
}

/** Delay before each reconnect attempt; after the last one the socket reports "lost". */
export const RECONNECT_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 16000];
