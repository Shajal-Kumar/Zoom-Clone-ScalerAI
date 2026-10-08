import type { EndReason } from "./close-codes";

function withParams(search: string | undefined, extra?: Record<string, string>): string {
  const params = new URLSearchParams(search ?? "");
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : "";
}

const base = (id: string) => `/meeting/${encodeURIComponent(id)}`;

/** `search` is a query string without the leading "?" (as in URLSearchParams.toString()). */
export const lobbyHref = (id: string, search?: string, extra?: Record<string, string>) =>
  `${base(id)}/lobby${withParams(search, extra)}`;

export const roomHref = (id: string, search?: string) => `${base(id)}/room${withParams(search)}`;

export const endHref = (id: string, reason: EndReason) => `${base(id)}/end?reason=${reason}`;
