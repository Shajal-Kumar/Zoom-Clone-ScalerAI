import { API_URL, DEFAULT_USER } from "./config";
import type { Meeting, MeetingExistsResponse, ScheduleRequest, UpdateMeetingRequest } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check that the backend is running on port 8000.");
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail) && body.detail[0]?.msg) {
        // FastAPI 422: "Value error, scheduled_start must be in the future"
        message = String(body.detail[0].msg).replace(/^Value error, /, "");
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export const swrKeys = {
  upcoming: "/api/meetings/upcoming?limit=20",
  recent: "/api/meetings/recent?limit=20",
} as const;

export const api = {
  createInstant: (title?: string) =>
    request<{ meeting: Meeting }>("/api/meetings/instant", {
      method: "POST",
      body: JSON.stringify({ host_id: DEFAULT_USER.id, ...(title ? { title } : {}) }),
    }).then((r) => r.meeting),

  schedule: (body: ScheduleRequest) =>
    request<{ meeting: Meeting }>("/api/meetings/schedule", {
      method: "POST",
      body: JSON.stringify({ host_id: DEFAULT_USER.id, ...body }),
    }).then((r) => r.meeting),

  updateMeeting: (id: string, data: UpdateMeetingRequest) =>
    request<{ meeting: Meeting }>(`/api/meetings/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }).then((r) => r.meeting),

  lookup: (id: string) =>
    request<MeetingExistsResponse>(`/api/meetings/${encodeURIComponent(id)}`),

  list: (key: string) => request<Meeting[]>(key),
};
