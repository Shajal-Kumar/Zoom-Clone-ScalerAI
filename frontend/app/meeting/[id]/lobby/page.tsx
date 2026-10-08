"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { AudioMeter } from "@/components/lobby/AudioMeter";
import { DeviceSelect } from "@/components/lobby/DeviceSelect";
import { PasscodeGate } from "@/components/lobby/PasscodeGate";
import { VideoPreview } from "@/components/lobby/VideoPreview";
import { MediaBanner } from "@/components/room/MediaBanner";
import { inputCls, primaryBtn, secondaryBtn } from "@/components/ui/Modal";
import { useAudioLevel } from "@/hooks/useAudioLevel";
import { DEFAULT_USER } from "@/lib/config";
import { roomHref } from "@/lib/routes";
import { getStoredPasscode, readStoredSettings, takePendingName } from "@/lib/storage";
import { useMeeting } from "@/providers/MeetingProvider";
import { useSettings } from "@/providers/SettingsProvider";

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center p-6">{children}</div>;
}

function Problem({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <Centered>
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-center">
        <AlertCircle className="mx-auto text-[var(--danger)]" size={32} aria-hidden />
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-[var(--muted)]">{body}</p>
        <div className="flex justify-center gap-2">{children}</div>
      </div>
    </Centered>
  );
}

function LobbyView() {
  const router = useRouter();
  const search = useSearchParams();
  const { settings } = useSettings();
  const { lookup, reloadLookup, media, join, resetToLobby } = useMeeting();

  const isHost = search.get("as") === "host";
  const shareIntent = search.get("intent") === "share";
  const passcodeNotice =
    search.get("e") === "passcode" ? "That passcode didn't work. Enter it again to rejoin." : null;

  const [name, setName] = useState("");
  const [passcode, setPasscode] = useState<string | null>(null);
  const [passcodeChecked, setPasscodeChecked] = useState(false);
  const initRef = useRef(false);

  // One-time init. The ref (not the effect's dependency list) is what keeps this safe under
  // React Strict Mode, which runs effects twice in development: pendingName is read-once.
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    resetToLobby(); // arriving via browser Back from the room tears the old session down
    const stored = readStoredSettings();
    setName((takePendingName() ?? stored?.displayName ?? DEFAULT_USER.name).slice(0, 120));
    media.start({
      audioEnabled: !(stored?.muteOnJoin ?? false),
      videoEnabled: !(stored?.videoOffOnJoin ?? false),
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A passcode that already passed verification in this tab (sessionStorage) skips the gate.
  const meetingKey = lookup.status === "ready" ? lookup.meeting.id : null;
  useEffect(() => {
    if (!meetingKey) return;
    setPasscode(getStoredPasscode(meetingKey));
    setPasscodeChecked(true);
  }, [meetingKey]);

  const level = useAudioLevel(media.stream, media.version, media.audioOn);

  if (lookup.status === "loading") {
    return (
      <Centered>
        <Loader2 className="animate-spin text-[var(--muted)]" aria-label="Loading meeting" />
      </Centered>
    );
  }
  if (lookup.status === "error") {
    return (
      <Problem title="Can't load this meeting" body={lookup.message}>
        <button className={primaryBtn} onClick={reloadLookup}>
          Try again
        </button>
        <Link href="/" className={secondaryBtn}>
          Home
        </Link>
      </Problem>
    );
  }
  if (lookup.status === "notfound") {
    return (
      <Problem title="Meeting not found" body="Check the meeting ID and try again.">
        <Link href="/" className={primaryBtn}>
          Back to home
        </Link>
      </Problem>
    );
  }
  if (lookup.status === "ended") {
    return (
      <Problem title="This meeting has ended" body={`“${lookup.meeting.title}” is over, so it can't be joined.`}>
        <Link href="/" className={primaryBtn}>
          Back to home
        </Link>
      </Problem>
    );
  }

  const meeting = lookup.meeting;
  const needsGate = meeting.passcode_required && !isHost; // A3: host bypasses
  if (needsGate && !passcodeChecked) return null;
  if (needsGate && !passcode) {
    return (
      <Centered>
        <div className="w-full space-y-4">
          <p className="text-center text-sm text-[var(--muted)]">{meeting.title}</p>
          <PasscodeGate meetingId={meeting.id} notice={passcodeNotice} onVerified={setPasscode} />
        </div>
      </Centered>
    );
  }

  const displayName = name.trim();
  const canJoin = displayName.length > 0;

  function handleJoin() {
    if (!canJoin) return;
    const query = new URLSearchParams(search.toString());
    query.delete("e");
    const queryString = query.toString();
    join({
      displayName,
      isHost,
      passcode: isHost ? undefined : (passcode ?? undefined),
      shareIntent,
      search: queryString,
    });
    router.push(roomHref(meeting.id, queryString));
  }

  return (
    <div className="min-h-screen">
      <MediaBanner audioIssue={media.audioIssue} videoIssue={media.videoIssue} onRetry={media.retry} />
      <div className="mx-auto grid w-full max-w-5xl gap-8 p-4 sm:p-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <VideoPreview
          stream={media.stream}
          version={media.version}
          name={displayName || "?"}
          audioOn={media.audioOn}
          videoOn={media.videoOn}
          onToggleAudio={media.toggleAudio}
          onToggleVideo={media.toggleVideo}
          mirror={settings.mirrorVideo}
        />

        <div className="space-y-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
              {isHost ? "Start meeting" : "Join meeting"}
            </p>
            <h1 className="mt-1 text-2xl font-semibold">{meeting.title}</h1>
            {meeting.host && <p className="text-sm text-[var(--muted)]">Hosted by {meeting.host.name}</p>}
          </div>

          <div>
            <label htmlFor="display-name" className="mb-1 block text-xs font-medium text-[var(--muted)]">
              Your name
            </label>
            <input
              id="display-name"
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            />
          </div>

          <div className="space-y-3">
            <DeviceSelect
              id="mic"
              label="Microphone"
              devices={media.devices.mics}
              value={media.micId}
              onChange={(id) => void media.selectDevice("audio", id)}
            />
            <AudioMeter level={level} muted={!media.audioOn} />
            <DeviceSelect
              id="camera"
              label="Camera"
              devices={media.devices.cams}
              value={media.camId}
              onChange={(id) => void media.selectDevice("video", id)}
            />
          </div>

          {shareIntent && (
            <p className="rounded-lg bg-[var(--hover)] px-3 py-2 text-sm text-[var(--muted)]">
              You&apos;ll get a Share screen button as soon as you&apos;re in.
            </p>
          )}

          <button className={`${primaryBtn} w-full py-3`} onClick={handleJoin} disabled={!canJoin}>
            {isHost ? "Start meeting" : "Join now"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LobbyPage() {
  return (
    <Suspense
      fallback={
        <Centered>
          <Loader2 className="animate-spin text-[var(--muted)]" aria-label="Loading" />
        </Centered>
      }
    >
      <LobbyView />
    </Suspense>
  );
}
