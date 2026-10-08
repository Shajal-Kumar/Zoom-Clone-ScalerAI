"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { ChatDrawer } from "@/components/ChatDrawer";
import { ControlBar, type DrawerKind } from "@/components/ControlBar";
import { MeetingHeader } from "@/components/MeetingHeader";
import { ParticipantsDrawer } from "@/components/ParticipantsDrawer";
import { ReactionOverlay } from "@/components/ReactionOverlay";
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

function RoomView() {
  const router = useRouter();
  const search = useSearchParams();
  const { settings } = useSettings();
  const {
    meetingId,
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
    chat,
    selfId,
    joinedAt,
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

  // Side drawer + unread chat badge. Opening chat marks everything seen; it stays seen while open.
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [seenChat, setSeenChat] = useState(0);
  useEffect(() => {
    if (drawer === "chat") setSeenChat(chat.length);
  }, [drawer, chat.length]);
  const toggleDrawer = useCallback((kind: Exclude<DrawerKind, null>) => {
    setDrawer((cur) => (cur === kind ? null : kind));
  }, []);
  // History delivered with room_state is not "new": start counting from what was there at join.
  const chatLenRef = useRef(0);
  chatLenRef.current = chat.length;
  useEffect(() => {
    if (joinedAt) setSeenChat(chatLenRef.current);
  }, [joinedAt]);
  const unreadChat = chat.slice(seenChat).filter((m) => m.sender_id !== selfId).length;

  if (phase !== "joining" && phase !== "joined") return null;

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

      <MeetingHeader />

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

      <div className="relative flex min-h-0 flex-1">
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-2 pb-2 sm:px-4">
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
          <ReactionOverlay />
        </main>

        {drawer && (
          <aside
            aria-label={drawer === "chat" ? "Chat" : "Participants"}
            className="absolute inset-y-0 right-0 z-30 w-full border-l border-[var(--border)] bg-[#13151B] sm:static sm:w-80 sm:shrink-0"
          >
            {drawer === "chat" ? (
              <ChatDrawer onClose={() => setDrawer(null)} />
            ) : (
              <ParticipantsDrawer onClose={() => setDrawer(null)} />
            )}
          </aside>
        )}
      </div>

      <ControlBar drawer={drawer} onToggleDrawer={toggleDrawer} unreadChat={unreadChat} />

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
