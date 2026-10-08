"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Mic, MicOff, MonitorUp, PhoneOff, Video, VideoOff, X } from "lucide-react";
import { Filmstrip, filmTile } from "@/components/room/Filmstrip";
import { MediaBanner } from "@/components/room/MediaBanner";
import { ReplaceShareDialog } from "@/components/room/ReplaceShareDialog";
import { Spotlight } from "@/components/room/Spotlight";
import { VideoGrid } from "@/components/room/VideoGrid";
import { VideoTile } from "@/components/room/VideoTile";
import { lobbyHref } from "@/lib/routes";
import { pickStreams } from "@/lib/streams";
import { useMeeting } from "@/providers/MeetingProvider";
import { useSettings } from "@/providers/SettingsProvider";

const ctrlBtn =
  "flex h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-white transition-colors";

function RoomView() {
  const router = useRouter();
  const search = useSearchParams();
  const { settings } = useSettings();
  const {
    meetingId,
    lookup,
    phase,
    displayName,
    participants,
    media,
    remoteStreams,
    socketStatus,
    reconnect,
    screen,
    shareCta,
    dismissShareCta,
    toast,
    leave,
    maxParticipants,
  } = useMeeting();

  // /room opened with no session (refresh, direct link) bounces back to the lobby, query kept.
  // A session that existed and was then reset (4005) is redirected by the provider instead.
  const sawSession = useRef(false);
  useEffect(() => {
    if (phase === "joining" || phase === "joined") {
      sawSession.current = true;
    } else if (phase === "lobby" && !sawSession.current) {
      router.replace(lobbyHref(meetingId, search.toString()));
    }
  }, [phase, meetingId, router, search]);

  if (phase !== "joining" && phase !== "joined") return null;

  const title = lookup.status === "ready" ? lookup.meeting.title : "Meeting";
  const sharer = participants.find((p) => p.is_sharing) ?? null;
  const localSharing = screen.local !== null;
  const spotlight = localSharing || sharer !== null;
  const tileCount = participants.length + 1;

  const selfTile = (className = "") => (
    <VideoTile
      key="self"
      stream={media.stream}
      version={media.version}
      name={`${displayName} (You)`}
      audioOn={media.audioOn}
      videoOn={media.videoOn}
      local
      mirror={settings.mirrorVideo}
      sharing={localSharing}
      className={className}
    />
  );

  const peerTiles = (className = "") =>
    participants.map((p) => {
      const { camera } = pickStreams(remoteStreams[p.client_id], p.screen_stream_id);
      return (
        <VideoTile
          key={p.client_id}
          stream={camera}
          name={p.display_name}
          audioOn={p.audio}
          videoOn={p.video}
          host={p.is_host}
          handRaised={p.hand_raised_at !== null}
          sharing={p.is_sharing}
          className={className}
        />
      );
    });

  const remoteScreen = sharer ? pickStreams(remoteStreams[sharer.client_id], sharer.screen_stream_id).screen : null;

  return (
    // The room is always dark regardless of the user's theme (A1): pin the dark variables here.
    <div data-theme="dark" className="fixed inset-0 z-40 flex flex-col bg-[var(--bg)] text-[var(--text)]">
      <MediaBanner audioIssue={media.audioIssue} videoIssue={media.videoIssue} onRetry={media.retry} />

      {socketStatus === "reconnecting" && (
        <div role="status" className="flex items-center justify-center gap-2 bg-amber-500/20 px-4 py-2 text-sm">
          <Loader2 size={14} className="animate-spin" aria-hidden /> Connection lost. Reconnecting…
        </div>
      )}
      {socketStatus === "lost" && (
        <div role="alert" className="flex items-center justify-center gap-3 bg-red-600/25 px-4 py-2 text-sm">
          Connection lost.
          <button onClick={reconnect} className="rounded-md bg-[var(--blue)] px-3 py-1 text-xs font-semibold text-white">
            Rejoin
          </button>
        </div>
      )}

      <header className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
        <span className="truncate font-medium">{title}</span>
        <span className="shrink-0 text-[var(--muted)]">
          {tileCount} / {maxParticipants}
        </span>
      </header>

      {shareCta && !localSharing && (
        <div className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-lg bg-[var(--card)] px-4 py-2 text-sm">
          <span>You joined to share your screen.</span>
          <span className="flex items-center gap-2">
            <button
              onClick={() => {
                dismissShareCta();
                screen.start();
              }}
              className="rounded-md bg-[var(--blue)] px-3 py-1 text-xs font-semibold text-white"
            >
              Share screen
            </button>
            <button onClick={dismissShareCta} aria-label="Dismiss" className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)]">
              <X size={14} />
            </button>
          </span>
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2 sm:px-4">
        {spotlight ? (
          <>
            <div className="min-h-0 flex-1">
              <Spotlight
                stream={localSharing ? null : remoteScreen}
                sharerName={sharer?.display_name ?? "Someone"}
                local={localSharing}
                onStop={screen.stop}
              />
            </div>
            <Filmstrip>
              {selfTile(filmTile)}
              {peerTiles(filmTile)}
            </Filmstrip>
          </>
        ) : (
          <div className="min-h-0 flex-1">
            <VideoGrid count={tileCount}>
              {selfTile()}
              {peerTiles()}
            </VideoGrid>
          </div>
        )}
      </main>

      {/* Bare controls: Module 5 replaces this with the full control bar and drawers. */}
      <footer className="flex items-center justify-center gap-2 bg-[#13151B] px-3 py-3">
        <button
          onClick={media.toggleAudio}
          className={`${ctrlBtn} ${media.audioOn ? "bg-white/10 hover:bg-white/20" : "bg-red-600 hover:bg-red-500"}`}
          aria-label={media.audioOn ? "Mute microphone" : "Unmute microphone"}
          aria-pressed={!media.audioOn}
        >
          {media.audioOn ? <Mic size={18} /> : <MicOff size={18} />}
        </button>
        <button
          onClick={media.toggleVideo}
          className={`${ctrlBtn} ${media.videoOn ? "bg-white/10 hover:bg-white/20" : "bg-red-600 hover:bg-red-500"}`}
          aria-label={media.videoOn ? "Turn camera off" : "Turn camera on"}
          aria-pressed={!media.videoOn}
        >
          {media.videoOn ? <Video size={18} /> : <VideoOff size={18} />}
        </button>
        <button
          onClick={localSharing ? screen.stop : screen.start}
          className={`${ctrlBtn} ${localSharing ? "bg-[var(--blue)] hover:bg-[var(--blue-hover)]" : "bg-white/10 hover:bg-white/20"}`}
          aria-label={localSharing ? "Stop sharing" : "Share screen"}
          aria-pressed={localSharing}
        >
          <MonitorUp size={18} />
          <span className="hidden sm:inline">{localSharing ? "Stop share" : "Share"}</span>
        </button>
        <button onClick={leave} className={`${ctrlBtn} bg-[var(--danger)] hover:opacity-90`}>
          <PhoneOff size={18} />
          <span>Leave</span>
        </button>
      </footer>

      {toast && (
        <div
          role="status"
          className="pointer-events-none fixed bottom-20 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-lg bg-black/80 px-4 py-2 text-sm text-white"
        >
          {toast}
        </div>
      )}

      <ReplaceShareDialog conflict={screen.conflict} onConfirm={screen.confirmReplace} onCancel={screen.cancelReplace} />
    </div>
  );
}

export default function RoomPage() {
  return (
    <Suspense fallback={null}>
      <RoomView />
    </Suspense>
  );
}
