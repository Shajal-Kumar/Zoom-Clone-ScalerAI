export type MeetingStatus = "scheduled" | "active" | "ended";

export interface Host {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  created_at: string;
}

export interface Meeting {
  id: string;
  title: string;
  description: string | null;
  host_id: string;
  status: MeetingStatus;
  scheduled_start: string | null;
  duration_minutes: number;
  passcode: string | null;
  created_at: string;
  host: Host | null;
}

export interface PublicMeeting extends Omit<Meeting, "passcode" | "host"> {
  passcode_required: boolean;
  host: Pick<Host, "id" | "name" | "avatar_url"> | null;
}

export interface MeetingExistsResponse {
  exists: boolean;
  meeting: PublicMeeting | null;
}

export interface ScheduleRequest {
  title: string;
  description?: string;
  scheduled_start: string; // ISO-8601 with offset (toISOString())
  duration_minutes: number;
  passcode?: string;
  host_id?: string;
}

/** Body of PATCH /api/meetings/{id}. Only the fields that changed are sent. */
export interface UpdateMeetingRequest {
  title?: string;
  passcode?: string;
  scheduled_start?: string; // ISO-8601 (toISOString())
}

/** POST /api/meetings/{id}/verify-passcode (always 200; 429 is thrown as ApiError). */
export interface VerifyPasscodeResponse {
  valid: boolean;
  reason: null | "incorrect" | "not_found" | "ended";
}

export interface Settings {
  displayName: string;
  muteOnJoin: boolean;
  videoOffOnJoin: boolean;
  mirrorVideo: boolean;
  theme: "light" | "dark";
}

/* ------------------------------------------------------------------ */
/* WebSocket protocol (mirrors backend/routes/ws.py)                    */
/* ------------------------------------------------------------------ */

/** Peer public shape: room_state.self, room_state.peers[], user_joined, user_left. */
export interface PeerInfo {
  client_id: string;
  display_name: string;
  is_host: boolean;
  audio: boolean;
  video: boolean;
  hand_raised_at: string | null;
  is_sharing: boolean;
  screen_stream_id: string | null;
}

export interface ChatMessage {
  id: string;
  text: string;
  sender_id: string;
  sender_name: string;
  is_host: boolean;
  ts: string;
}

/** Every server -> client message. `from` is stamped by the server. */
export interface Envelope<P = Record<string, unknown>> {
  type: string;
  from: string | null;
  to: string | null;
  payload: P;
  ts: string;
}

export interface RoomStatePayload {
  self: PeerInfo;
  peers: PeerInfo[];
  chat_history: ChatMessage[];
  max_participants: number;
}

export interface ErrorPayload {
  code: string;
  message: string;
  sharer_id?: string;
  sharer_name?: string;
}

export type HostActionName = "mute" | "mute_all" | "kick" | "stop_share" | "end_meeting";
