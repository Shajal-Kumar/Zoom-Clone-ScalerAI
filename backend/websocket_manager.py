"""In-memory WebSocket rooms for WebRTC signalling.

Rooms are plain Python objects living in this process, so the API must run
with a single worker (``uvicorn main:app``). Scaling out would need a shared
pub/sub layer such as Redis, which is intentionally out of scope.

Lifecycle rules enforced here (the database is kept in sync via ``lifecycle``):

* A room only exists while somebody has connected. A meeting nobody joins has
  no room and no timers, so it can never be auto-ended.
* The first join flips a ``scheduled`` meeting to ``active``.
* When the last participant leaves, the meeting stays ``active`` for
  ``settings.empty_room_grace_seconds``. Any rejoin cancels the countdown.
  Only if the window lapses is the meeting marked ``ended``.
* A host ``end_meeting`` ends it immediately and closes every socket.
"""

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from fastapi import WebSocket
from starlette.concurrency import run_in_threadpool

import lifecycle
from config import settings
from utils import utcnow

logger = logging.getLogger("zoom_clone.ws")


class CloseCode:
    """Application close codes (4000-4999 is the private-use range)."""

    GOING_AWAY = 1001
    INTERNAL_ERROR = 1011
    MEETING_ENDED = 4001
    REMOVED_BY_HOST = 4003
    NOT_FOUND = 4004
    PASSCODE = 4005
    ROOM_FULL = 4008
    REPLACED = 4009
    IDLE_TIMEOUT = 4010
    BAD_REQUEST = 4400


def iso_z(moment: datetime | None) -> str | None:
    """ISO-8601 with a ``Z`` suffix, or ``None``."""
    return moment.isoformat().replace("+00:00", "Z") if moment else None


class JoinRejected(Exception):
    """Raised when a connection may not enter a room."""

    def __init__(self, code: int, reason: str) -> None:
        super().__init__(reason)
        self.code = code
        self.reason = reason


def make_envelope(
    msg_type: str,
    *,
    sender: str | None = None,
    to: str | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Every message the server emits has this shape.

    ``from`` is always stamped by the server, never trusted from the client.
    """
    return {
        "type": msg_type,
        "from": sender,
        "to": to,
        "payload": payload or {},
        "ts": iso_z(utcnow()),
    }


@dataclass(eq=False)
class Peer:
    client_id: str
    display_name: str
    websocket: WebSocket
    user_id: str | None = None
    is_host: bool = False
    participant_id: str | None = None
    audio: bool = False
    video: bool = False
    hand_raised_at: datetime | None = None
    screen_stream_id: str | None = None
    chat_times: deque = field(default_factory=deque)
    reaction_times: deque = field(default_factory=deque)

    @property
    def is_sharing(self) -> bool:
        return self.screen_stream_id is not None

    def public(self) -> dict[str, Any]:
        return {
            "client_id": self.client_id,
            "display_name": self.display_name,
            "is_host": self.is_host,
            "audio": self.audio,
            "video": self.video,
            "hand_raised_at": iso_z(self.hand_raised_at),
            "is_sharing": self.is_sharing,
            "screen_stream_id": self.screen_stream_id,
        }


@dataclass(eq=False)
class Room:
    meeting_id: str
    peers: dict[str, Peer] = field(default_factory=dict)
    chat_history: deque = field(
        default_factory=lambda: deque(maxlen=settings.chat_history_size)
    )
    banned: set[str] = field(default_factory=set)
    sharer_id: str | None = None  # client_id of the single active screen sharer
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    grace_task: asyncio.Task | None = None
    ended: bool = False


class ConnectionManager:
    """Tracks active WebSocket connections grouped by ``meeting_id``."""

    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}

    # ------------------------------------------------------------------ #
    # Joining and leaving
    # ------------------------------------------------------------------ #
    async def connect(self, meeting_id: str, peer: Peer) -> Room:
        """Admit ``peer`` to the room or raise :class:`JoinRejected`.

        The socket must already be accepted. Reusing a ``client_id`` replaces
        the older connection (page refresh / second tab) instead of failing.
        """
        room = self._rooms.get(meeting_id)
        if room is None:
            room = Room(meeting_id=meeting_id)
            self._rooms[meeting_id] = room

        try:
            async with room.lock:
                if room.ended:
                    raise JoinRejected(CloseCode.NOT_FOUND, "Meeting has ended")
                if peer.client_id in room.banned:
                    raise JoinRejected(
                        CloseCode.REMOVED_BY_HOST, "You were removed from this meeting"
                    )
                replaced = room.peers.get(peer.client_id)
                if replaced is None and len(room.peers) >= settings.max_room_participants:
                    raise JoinRejected(CloseCode.ROOM_FULL, "This meeting is full")

                # Claim the slot before awaiting anything, so the grace timer
                # cannot end the meeting underneath a join that is in flight.
                had_grace = room.grace_task is not None
                room.peers[peer.client_id] = peer
                self._cancel_grace(room)

                # Persist first. If this fails, the older duplicate connection
                # (if any) is restored instead of leaving the user with none.
                try:
                    participant_id = await run_in_threadpool(
                        lifecycle.register_join,
                        room.meeting_id,
                        peer.display_name,
                        peer.is_host,
                    )
                except Exception:
                    logger.exception("register_join failed for meeting %s", meeting_id)
                    self._rollback_join(room, peer, replaced, had_grace)
                    raise JoinRejected(CloseCode.INTERNAL_ERROR, "Could not join meeting")

                if participant_id is None:
                    self._rollback_join(room, peer, replaced, had_grace)
                    raise JoinRejected(CloseCode.NOT_FOUND, "Meeting not found or has ended")
                peer.participant_id = participant_id

                if replaced is not None:
                    # Same client_id: the old tab's share (if any) is gone.
                    await self.stop_share(room, replaced, "left", notify_sharer=False)
                    await self.close_quietly(
                        replaced.websocket, CloseCode.REPLACED, "Connected from another tab"
                    )
                    await self.broadcast(
                        room,
                        make_envelope(
                            "user_left", sender=replaced.client_id, payload=replaced.public()
                        ),
                        exclude={peer.client_id},
                    )
        except JoinRejected:
            self._discard_if_idle(room)
            raise
        return room

    async def disconnect(self, room: Room, peer: Peer) -> None:
        """Clean up after a socket closed for any reason.

        Shielded: if the handler task is cancelled (server shutdown, test
        harness) the cleanup still finishes, so shares, rooms and DB rows
        are never left half-updated.
        """
        await asyncio.shield(self._disconnect(room, peer))

    async def _disconnect(self, room: Room, peer: Peer) -> None:
        is_current = room.peers.get(peer.client_id) is peer
        if is_current:
            del room.peers[peer.client_id]

        if peer.participant_id is not None:
            try:
                await run_in_threadpool(lifecycle.register_leave, peer.participant_id)
            except Exception:
                logger.exception("register_leave failed for %s", peer.participant_id)

        # A replaced or evicted peer is not a departure the room should hear about.
        if not is_current or room.ended:
            return

        await self.stop_share(room, peer, "left")
        await self.broadcast(
            room,
            make_envelope("user_left", sender=peer.client_id, payload=peer.public()),
        )
        if not room.peers and not room.ended:
            self._start_grace(room)

    async def end_room(self, room: Room, *, ended_by: Peer) -> None:
        """Host ended the meeting for everyone: notify, persist, close."""
        if room.ended:
            return
        room.ended = True
        self._cancel_grace(room)
        peers = list(room.peers.values())
        room.peers.clear()
        if self._rooms.get(room.meeting_id) is room:
            del self._rooms[room.meeting_id]

        notice = make_envelope(
            "host_action", sender=ended_by.client_id, payload={"action": "end_meeting"}
        )
        await asyncio.gather(*(self.send(p, notice) for p in peers))
        try:
            await run_in_threadpool(lifecycle.end_meeting, room.meeting_id)
        except Exception:
            logger.exception("end_meeting failed for %s", room.meeting_id)
        await asyncio.gather(
            *(
                self.close_quietly(p.websocket, CloseCode.MEETING_ENDED, "Meeting ended by host")
                for p in peers
            )
        )

    async def close_all(self) -> None:
        """Server shutdown: drop sockets and timers. Meetings are NOT ended,
        since a restart is not the same thing as the host ending the call."""
        rooms = list(self._rooms.values())
        self._rooms.clear()
        for room in rooms:
            room.ended = True
            self._cancel_grace(room)
            peers = list(room.peers.values())
            room.peers.clear()
            await asyncio.gather(
                *(
                    self.close_quietly(p.websocket, CloseCode.GOING_AWAY, "Server shutting down")
                    for p in peers
                )
            )

    # ------------------------------------------------------------------ #
    # Sending
    # ------------------------------------------------------------------ #
    async def send(self, peer: Peer, message: dict[str, Any]) -> bool:
        """Send to one peer. A failing socket is closed so its handler cleans up."""
        try:
            await peer.websocket.send_json(message)
            return True
        except Exception:
            logger.debug("Dropping unreachable peer %s", peer.client_id)
            await self.close_quietly(peer.websocket, CloseCode.GOING_AWAY, "Send failed")
            return False

    async def send_error(
        self, peer: Peer, code: str, message: str, extra: dict[str, Any] | None = None
    ) -> None:
        await self.send(
            peer,
            make_envelope(
                "error",
                to=peer.client_id,
                payload={"code": code, "message": message, **(extra or {})},
            ),
        )

    async def send_to(self, room: Room, client_id: str, message: dict[str, Any]) -> bool:
        target = room.peers.get(client_id)
        if target is None:
            return False
        return await self.send(target, message)

    async def broadcast(
        self,
        room: Room,
        message: dict[str, Any],
        *,
        exclude: set[str] | frozenset[str] = frozenset(),
    ) -> None:
        targets = [p for cid, p in list(room.peers.items()) if cid not in exclude]
        if targets:
            await asyncio.gather(*(self.send(p, message) for p in targets))

    @staticmethod
    async def close_quietly(websocket: WebSocket, code: int, reason: str) -> None:
        try:
            await websocket.close(code=code, reason=reason[:120])
        except Exception:
            pass  # already closed / disconnected

    # ------------------------------------------------------------------ #
    # Helpers used by the protocol layer
    # ------------------------------------------------------------------ #
    def room_state(self, room: Room, peer: Peer) -> dict[str, Any]:
        """First message a newcomer receives: who is here and recent chat."""
        return make_envelope(
            "room_state",
            to=peer.client_id,
            payload={
                "self": peer.public(),
                "peers": [p.public() for cid, p in room.peers.items() if cid != peer.client_id],
                "chat_history": list(room.chat_history),
                "max_participants": settings.max_room_participants,
            },
        )

    async def stop_share(
        self, room: Room, sharer: Peer, reason: str, *, notify_sharer: bool = True
    ) -> bool:
        """Clear the room's screen share if ``sharer`` owns it and tell the room.

        ``reason``: stopped | replaced | left | stopped_by_host.
        """
        if room.sharer_id != sharer.client_id:
            return False
        room.sharer_id = None
        sharer.screen_stream_id = None
        await self.broadcast(
            room,
            make_envelope(
                "screen_share",
                sender=sharer.client_id,
                payload={"active": False, "reason": reason},
            ),
            exclude=frozenset() if notify_sharer else frozenset({sharer.client_id}),
        )
        return True

    @staticmethod
    def _within_limit(times: deque, count: int, window: float) -> bool:
        now = time.monotonic()
        while times and now - times[0] > window:
            times.popleft()
        if len(times) >= count:
            return False
        times.append(now)
        return True

    @classmethod
    def allow_chat(cls, peer: Peer) -> bool:
        return cls._within_limit(
            peer.chat_times,
            settings.chat_rate_limit_count,
            settings.chat_rate_limit_window_seconds,
        )

    @classmethod
    def allow_reaction(cls, peer: Peer) -> bool:
        return cls._within_limit(
            peer.reaction_times,
            settings.reaction_rate_limit_count,
            settings.reaction_rate_limit_window_seconds,
        )

    # ------------------------------------------------------------------ #
    # Empty-room grace period
    # ------------------------------------------------------------------ #
    def _remove_peer(self, room: Room, peer: Peer) -> None:
        if room.peers.get(peer.client_id) is peer:
            del room.peers[peer.client_id]

    def _rollback_join(
        self, room: Room, peer: Peer, replaced: Peer | None, had_grace: bool
    ) -> None:
        """Undo a failed join: restore the replaced connection or free the slot."""
        if room.peers.get(peer.client_id) is peer:
            if replaced is not None:
                room.peers[peer.client_id] = replaced
            else:
                del room.peers[peer.client_id]
        if not room.peers and had_grace and not room.ended:
            self._start_grace(room)  # the cancelled countdown must not be lost

    def _discard_if_idle(self, room: Room) -> None:
        """Forget a room nobody ever managed to enter."""
        if not room.peers and room.grace_task is None and self._rooms.get(room.meeting_id) is room:
            del self._rooms[room.meeting_id]

    def _start_grace(self, room: Room) -> None:
        self._cancel_grace(room)
        room.grace_task = asyncio.create_task(
            self._expire(room), name=f"expire-room-{room.meeting_id}"
        )

    def _cancel_grace(self, room: Room) -> None:
        task, room.grace_task = room.grace_task, None
        if task is not None and not task.done() and task is not asyncio.current_task():
            task.cancel()

    async def _expire(self, room: Room) -> None:
        await asyncio.sleep(settings.empty_room_grace_seconds)
        if room.peers or room.ended or self._rooms.get(room.meeting_id) is not room:
            return
        # From here on joins are refused (room.ended), so the meeting can be
        # ended without racing a late arrival.
        room.ended = True
        room.grace_task = None
        try:
            await run_in_threadpool(lifecycle.end_meeting, room.meeting_id)
            logger.info("Meeting %s ended after empty-room grace period", room.meeting_id)
        except Exception:
            logger.exception("end_meeting failed for %s", room.meeting_id)
        finally:
            if self._rooms.get(room.meeting_id) is room:
                del self._rooms[room.meeting_id]
