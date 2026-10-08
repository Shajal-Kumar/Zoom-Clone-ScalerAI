"use client";

import { useEffect, useRef } from "react";
import { Mic, MicOff, Video, VideoOff } from "lucide-react";
import { initials } from "@/lib/streams";

interface VideoPreviewProps {
  stream: MediaStream | null;
  version: number;
  name: string;
  audioOn: boolean;
  videoOn: boolean;
  /** Toggle position (not effective state): lets the user turn a device on that failed to start. */
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  mirror: boolean;
}

export function VideoPreview({
  stream,
  version,
  name,
  audioOn,
  videoOn,
  onToggleAudio,
  onToggleVideo,
  mirror,
}: VideoPreviewProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) el.play().catch(() => {});
  }, [stream, version]);

  const btn = (off: boolean) =>
    `flex h-11 w-11 items-center justify-center rounded-full border text-white transition-colors ${
      off ? "border-red-500 bg-red-600 hover:bg-red-500" : "border-white/30 bg-black/50 hover:bg-black/70"
    }`;

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-[#0b0e14]">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        className={`h-full w-full object-cover ${videoOn ? "" : "invisible"}`}
        style={mirror ? { transform: "scaleX(-1)" } : undefined}
      />
      {!videoOn && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[var(--blue)] text-3xl font-semibold text-white">
            {initials(name)}
          </div>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-3 flex justify-center gap-3">
        <button
          type="button"
          onClick={onToggleAudio}
          className={btn(!audioOn)}
          aria-label={audioOn ? "Mute microphone" : "Unmute microphone"}
          aria-pressed={!audioOn}
        >
          {audioOn ? <Mic size={18} /> : <MicOff size={18} />}
        </button>
        <button
          type="button"
          onClick={onToggleVideo}
          className={btn(!videoOn)}
          aria-label={videoOn ? "Turn camera off" : "Turn camera on"}
          aria-pressed={!videoOn}
        >
          {videoOn ? <Video size={18} /> : <VideoOff size={18} />}
        </button>
      </div>
    </div>
  );
}
