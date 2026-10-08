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

export interface Settings {
  displayName: string;
  muteOnJoin: boolean;
  videoOffOnJoin: boolean;
  mirrorVideo: boolean;
  theme: "light" | "dark";
}
