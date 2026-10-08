export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000";

export const DEFAULT_USER = { id: "usr_default", name: "Shajal Kumar Chaudhary" } as const;

export const STORAGE = {
  settings: "zoomclone.settings.v1",
  /** Display name typed in the Join modal; the lobby reads it once. */
  pendingName: "zoomclone.pendingName",
  /** sessionStorage: stable WebSocket client_id for this tab (reconnects reuse it). */
  clientId: "zoomclone.clientId",
  /** sessionStorage: `${passcodePrefix}${meetingId}` holds a passcode that passed verification. */
  passcodePrefix: "zoomclone.passcode.",
} as const;
