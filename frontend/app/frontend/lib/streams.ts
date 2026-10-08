/**
 * Splits a remote peer's MediaStreams into camera and screen.
 *
 * The camera stream is the first stream that arrived for the peer which is not the announced
 * screen stream. The screen stream is looked up by the id the server relayed in
 * `screen_stream_id` (ontrack can fire before that signalling message, so streams are kept
 * and matched lazily).
 */
export function pickStreams(
  streams: MediaStream[] | undefined,
  screenStreamId: string | null,
): { camera: MediaStream | null; screen: MediaStream | null } {
  const list = streams ?? [];
  const screen = screenStreamId ? (list.find((s) => s.id === screenStreamId) ?? null) : null;
  const camera = list.find((s) => s.id !== screenStreamId) ?? null;
  return { camera, screen };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}
