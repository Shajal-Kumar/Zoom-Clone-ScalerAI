import { STORAGE } from "./config";
import type { Settings } from "./types";

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function local(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function randomToken(length: number): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID().replace(/-/g, "").slice(0, length);
    }
  } catch {
    /* fall through */
  }
  let out = "";
  while (out.length < length) out += Math.floor(Math.random() * 36).toString(36);
  return out;
}

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Stable per-tab WebSocket client_id (sessionStorage), so a refresh or reconnect reuses it.
 * Note: "Duplicate tab" copies sessionStorage, so the copy shares the id and the older tab
 * is closed with 4009. Open test tabs fresh (new tab + paste URL), not via Duplicate.
 */
export function getClientId(): string {
  const store = session();
  try {
    const existing = store?.getItem(STORAGE.clientId);
    if (existing && CLIENT_ID_RE.test(existing)) return existing;
  } catch {
    /* ignore */
  }
  const id = `c_${randomToken(20)}`;
  try {
    store?.setItem(STORAGE.clientId, id);
  } catch {
    /* private mode: id lives for this page load only */
  }
  return id;
}

export function getStoredPasscode(meetingId: string): string | null {
  try {
    return session()?.getItem(STORAGE.passcodePrefix + meetingId) ?? null;
  } catch {
    return null;
  }
}

export function storePasscode(meetingId: string, passcode: string): void {
  try {
    session()?.setItem(STORAGE.passcodePrefix + meetingId, passcode);
  } catch {
    /* ignore */
  }
}

export function clearStoredPasscode(meetingId: string): void {
  try {
    session()?.removeItem(STORAGE.passcodePrefix + meetingId);
  } catch {
    /* ignore */
  }
}

/** Read-once: returns the Join-modal name and removes it. */
export function takePendingName(): string | null {
  const store = session();
  try {
    const value = store?.getItem(STORAGE.pendingName) ?? null;
    if (value !== null) store?.removeItem(STORAGE.pendingName);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Settings straight from localStorage. SettingsProvider hydrates in an effect, so on the
 * first lobby render useSettings() still holds defaults; the lobby needs the real values
 * to initialise its mic/camera toggles.
 */
export function readStoredSettings(): Partial<Settings> | null {
  try {
    const raw = local()?.getItem(STORAGE.settings);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Partial<Settings>) : null;
  } catch {
    return null;
  }
}
