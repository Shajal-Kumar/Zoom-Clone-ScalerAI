import { DEFAULT_USER } from "./config";
import { formatMeetingId } from "./ids";
import type { Meeting } from "./types";

export const meetingLink = (id: string): string => `${window.location.origin}/meeting/${id}`;

export const formatWhen = (iso: string | null, opts?: Intl.DateTimeFormatOptions): string =>
  iso
    ? new Date(iso).toLocaleString(undefined, opts ?? { dateStyle: "medium", timeStyle: "short" })
    : "";

/** Plain-text invitation. The link never carries the passcode. */
export function buildInvitation(m: Meeting): string {
  const lines = [
    `${m.host?.name ?? DEFAULT_USER.name} is inviting you to a Zoom Clone meeting.`,
    "",
    `Topic: ${m.title}`,
  ];
  if (m.status === "scheduled" && m.scheduled_start) {
    lines.push(`Time: ${formatWhen(m.scheduled_start, { dateStyle: "full", timeStyle: "short" })}`);
  }
  lines.push(`Join: ${meetingLink(m.id)}`, `Meeting ID: ${formatMeetingId(m.id)}`);
  if (m.passcode) lines.push(`Passcode: ${m.passcode}`);
  return lines.join("\n");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts / denied permission.
    const area = document.createElement("textarea");
    area.value = text;
    area.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
