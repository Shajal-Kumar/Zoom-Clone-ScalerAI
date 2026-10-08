# Zoom

A video meeting app that runs in the browser. You can start an instant meeting, schedule one for later, join with a meeting ID, and talk to other people with camera, microphone, screen sharing, chat and reactions. Built as a full-stack assignment.

Live demo: https://zoom-clone-scaler-ai.vercel.app

## What it does

- Start an instant meeting or schedule one, with an optional passcode
- Lobby with camera preview, mic level meter and device selection before you join
- Video grid for up to 6 people, with an active speaker highlight
- Screen sharing with a spotlight view (one sharer at a time, with a prompt before replacing someone's share)
- In-meeting chat, emoji reactions and raise hand
- Host controls: mute one person or everyone, remove someone, stop their screen share, end the meeting for all
- Dashboard with upcoming and recent meetings, plus edit and reschedule
- Light and dark theme (the meeting room is always dark)

## How it works

Video and audio do not go through the server. Every participant connects directly to every other participant using WebRTC (a full mesh), which is why rooms are capped at 6. The backend only does signalling: it passes offers, answers and ICE candidates between browsers over a WebSocket, and also handles chat, reactions, hand raising and host actions on the same socket.

```
Browser A <------ WebRTC media ------> Browser B
    |                                      |
    +-------- WebSocket signalling --------+
                      |
                 FastAPI server
                      |
                   SQLite
```

Room state (who is in the room, chat history, who is sharing) lives in memory on the server, and SQLite stores users and meetings. Because of that, the backend must run as a single process.

## Tech stack

**Frontend:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, SWR, Lucide icons. UI components are written by hand, no component library.

**Backend:** FastAPI, SQLAlchemy 2, SQLite, Pydantic v2, WebSockets.

**Realtime:** native browser WebRTC with a WebSocket signalling channel. No third-party video SDK.

## Project structure

```
backend/
  main.py                 app setup, CORS, startup
  config.py               settings (env vars use the ZOOM_ prefix)
  models.py, schemas.py   database models and API schemas
  routes/meetings.py      REST endpoints
  routes/ws.py            WebSocket signalling and host actions
  websocket_manager.py    rooms, peers, rate limits
  lifecycle.py            meeting status and cleanup
  seed.py                 demo data
  tests/                  pytest suite
frontend/
  app/                    pages: dashboard, meetings list, lobby, room, end
  components/             UI, control bar, chat and participants drawers
  hooks/                  media, WebRTC, socket, screen share, audio level
  providers/              meeting and settings state
  lib/                    API client, types, helpers
```

## Running it locally

You need Node 20+ and Python 3.11+.

**Backend**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # on Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API docs are at http://localhost:8000/docs. Demo data is created on first start.

**Frontend**

```bash
cd frontend
cp env.local.example .env.local
npm install
npm run dev
```

Open http://localhost:3000.

To try a call with yourself, open the meeting link in two tabs or two browsers. Use a different browser profile for the second one, since copying a tab reuses the same client ID and the first tab gets disconnected.

## Configuration

| Where | Variable | Purpose |
|---|---|---|
| Frontend | `NEXT_PUBLIC_API_URL` | Backend base URL, e.g. `https://api.example.com` |
| Frontend | `NEXT_PUBLIC_WS_URL` | Backend WebSocket URL, e.g. `wss://api.example.com` |
| Frontend | `NEXT_PUBLIC_TURN_URL`, `_USERNAME`, `_CREDENTIAL` | Optional TURN server for strict networks |
| Backend | `ZOOM_CORS_ORIGINS` | JSON list of allowed frontend origins, e.g. `["https://my-app.vercel.app"]` |
| Backend | `ZOOM_DATABASE_URL` | Database URL, defaults to a local SQLite file |
| Backend | `ZOOM_SEED_ON_STARTUP` | Create demo data when the database is empty (default `true`) |

## Deploying

The frontend and backend are deployed separately.

- **Backend (Railway or Render):** set the root directory to `backend`, start with `uvicorn main:app --host 0.0.0.0 --port $PORT`, and use one worker only. Set `ZOOM_CORS_ORIGINS` to your frontend URL.
- **Frontend (Vercel):** set the root directory to `frontend` and add the two `NEXT_PUBLIC_` URLs before the first build. They are baked in at build time, so redeploy after changing them.

Camera and microphone access only works over HTTPS, and the WebSocket URL must use `wss://` in production.

## API

| Method | Path | What it does |
|---|---|---|
| POST | `/api/meetings/instant` | Create a meeting that is active now |
| POST | `/api/meetings/schedule` | Schedule a meeting |
| GET | `/api/meetings/upcoming` | Upcoming meetings |
| GET | `/api/meetings/recent` | Recent meetings |
| GET | `/api/meetings/{id}` | Look up a meeting (passcode is masked) |
| PATCH | `/api/meetings/{id}` | Edit a meeting |
| POST | `/api/meetings/{id}/verify-passcode` | Check a passcode |
| WS | `/ws/meeting/{id}/{client_id}` | Signalling, chat, reactions, host actions |

Check `/docs` on the running backend for the exact paths and request bodies.

## Tests

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

## Assumptions and limitations

- **Mock auth.** There is one built-in user. Opening a meeting with `?as=host` makes you the host. Anyone who knows that URL can do it, so this is not real authentication.
- **Mesh scaling.** Every extra person adds a connection for everyone else. Six is the limit.
- **TURN.** Only a public STUN server is configured by default. People behind strict firewalls may not be able to see each other without a TURN server.
- **Single instance.** Rooms and chat history are in memory, so the backend cannot be scaled to multiple instances, and chat is lost when a room empties.
- **Meeting timer.** The duration shown counts from when you joined, not from when the meeting started.
- **Demo data.** Seeded users and meetings are fake. The personal meeting ID on the dashboard is a UI placeholder.
- **Camera light.** Turning the camera off disables the video track but the browser's camera indicator may stay on.
- **Testing.** Multi-person calls across different networks have not been tested.
