export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000";

export const DEFAULT_USER = { id: "usr_default", name: "Shajal Kumar Chaudhary" } as const;

export const STORAGE = {
  settings: "zoomclone.settings.v1",
  /** Display name typed in the Join modal; the lobby reads it once. */
  pendingName: "zoomclone.pendingName",
} as const;
