"use client";

import { useEffect, useRef, useState } from "react";
import { MicOff, VideoOff } from "lucide-react";
import { useAudioLevel } from "@/hooks/useAudioLevel";
import { initials } from "@/lib/streams";

const SPEAK_THRESHOLD = 0.12;
const SPEAK_HOLD_MS = 450;

interface VideoTileProps {
  stream: MediaStream | null;
  name: string;
  audioOn: boolean;
  videoOn: boolean;
  /** Local tile: element is muted (no echo) and can be mirrored. */
  local?: boolean;
  mirror?: boolean;
  host?: boolean;
  handRaised?: boolean;
  sharing?: boolean;
  /** Bumps when tracks are swapped inside the same MediaStream (local camera). */
  version?: number;
  className?: string;
}

/**
 * One participant. The <video> element is ALWAYS rendered (just hidden when the camera is
 * off) because for remote peers it is also the thing that plays their audio.
 */
export function VideoTile({
  stream,
  name,
  audioOn,
  videoOn,
  local = false,
  mirror = false,
  host = false,
  handRaised = false,
  sharing = false,
  version = 0,
  className = "",
}: VideoTileProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) el.play().catch(() => {});
  }, [stream, version]);

  const showVideo = videoOn && stream !== null;

  // Active speaker: level above a threshold, held briefly so the ring doesn't flicker between words.
  // Remote tracks can be added to a stream after it first appears, so the audio track count joins the key.
  const audioTracks = stream ? stream.getAudioTracks().length : 0;
  const level = useAudioLevel(stream, version * 100 + audioTracks, audioOn && audioTracks > 0);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (level > SPEAK_THRESHOLD) {
      setSpeaking(true);
      return;
    }
    const t = setTimeout(() => setSpeaking(false), SPEAK_HOLD_MS);
    return () => clearTimeout(t);
  }, [level]);
  const active = speaking && audioOn;

  return (
    <div
      className={`relative min-h-0 min-w-0 overflow-hidden rounded-xl bg-[var(--card)] transition-shadow ${
        active ? "ring-2 ring-emerald-500" : ""
      } ${className}`}
      aria-label={`${name}${audioOn ? "" : ", muted"}${videoOn ? "" : ", camera off"}`}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={local}
        className={`absolute inset-0 h-full w-full object-cover ${showVideo ? "" : "invisible"}`}
        style={mirror && local ? { transform: "scaleX(-1)" } : undefined}
      />

      {!showVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--blue)] text-xl font-semibold text-white sm:h-20 sm:w-20 sm:text-2xl">
            {initials(name)}
          </div>
        </div>
      )}

      <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5 text-xs">
        <span className="flex max-w-full items-center gap-1 truncate rounded-md bg-black/60 px-2 py-1 font-medium text-white">
          {!audioOn && <MicOff size={12} className="shrink-0 text-red-400" aria-hidden />}
          {!videoOn && <VideoOff size={12} className="shrink-0 text-red-400" aria-hidden />}
          <span className="truncate">{name}</span>
        </span>
        {host && <span className="rounded-md bg-black/60 px-1.5 py-1 font-semibold text-amber-300">Host</span>}
      </div>

      {(handRaised || sharing) && (
        <div className="absolute right-2 top-2 flex gap-1">
          {sharing && <span className="rounded-md bg-[var(--blue)] px-1.5 py-1 text-xs font-semibold text-white">Sharing</span>}
          {handRaised && (
            <span className="rounded-md bg-amber-400 px-1.5 py-0.5 text-sm" role="img" aria-label="Hand raised">
              ✋
            </span>
          )}
        </div>
      )}
    </div>
  );
}
