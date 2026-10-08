"""WebRTC signalling over WebSocket: ``WS /ws/meeting/{meeting_id}/{client_id}``.

Connect with ``?name=<display name>`` and, for the host, ``?user_id=<host user id>``.
Guests of a passcode-protected meeting must add ``&passcode=<code>`` (the host
bypasses it); optional ``&audio=1|0&video=1|0`` seed the initial media state.
A client is the host when ``user_id`` equals ``meeting.host_id``. (Mock-auth
only: the query parameter is trusted, so this is not real authentication.)

Client -> server messages are JSON ``{"type", "to"?, "payload"}``:

* ``offer`` / ``answer`` / ``candidate``  targeted at ``to`` (a client_id)
* ``chat_message``                        ``payload.text``, broadcast to the room
* ``host_action``                         ``payload.action`` in mute | mute_all | kick
                                          | stop_share | end_meeting (+ ``payload.target_client_id``)
* ``media_state``                         ``{audio, video}`` booleans, relayed to the others
* ``screen_share``                        ``{active, stream_id, force?}``; one sharer per room
* ``raise_hand``                          ``{raised, target_client_id?}`` (only hosts may target others, to lower)
* ``reaction``                            ``{emoji}`` from a fixed set, broadcast to everyone
* ``ping``                                answered with ``pong`` (use as heartbeat)

Server -> client messages always have the shape
``{"type", "from", "to", "payload", "ts"}`` with ``from`` stamped by the server:

* ``room_state``   sent once on join: self, existing peers, chat history. The
                   newcomer should send an ``offer`` to every listed peer.
* ``user_joined`` / ``user_left``   broadcast to the others
* ``error``        ``payload.code`` / ``payload.message``; the socket stays open.
                   ``share_in_progress`` also carries ``sharer_id`` / ``sharer_name``.

Close codes: 4001 meeting ended, 4003 removed by host, 4004 not found/ended,
4005 passcode missing/incorrect, 4008 room full, 4009 replaced by a newer connection, 4010 idle timeout,
4400 bad request.
"""

import asyncio
import json
import re
import uuid
from typing import Any

from fastapi import APIRouter, Query, WebSocket
from starlette.concurrency import run_in_threadpool

import lifecycle
from config import settings
from models import MeetingStatus
from passcode import passcode_limiter, passcodes_match
from utils import normalize_meeting_id, utcnow
from websocket_manager import (
    CloseCode,
    ConnectionManager,
    JoinRejected,
    Peer,
    Room,
    iso_z,
    make_envelope,
)

router = APIRouter()

_CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_RELAY_TYPES = {"offer", "answer", "candidate"}
_SERVER_ONLY_TYPES = {"user_joined", "user_left", "room_state", "error", "pong"}
_HOST_ACTIONS = {"mute", "mute_all", "kick", "stop_share", "end_meeting"}
_REACTIONS = {"👍", "👏", "❤️", "😂", "😮", "🎉"}


def _flag(value: str) -> bool:
    return value.strip().lower() in {"1", "true"}


@router.websocket("/ws/meeting/{meeting_id}/{client_id}")
async def meeting_socket(
    websocket: WebSocket,
    meeting_id: str,
    client_id: str,
    name: str = Query(default="Guest", max_length=120),
    user_id: str | None = Query(default=None, max_length=36),
    passcode: str | None = Query(default=None, max_length=64),
    audio: str = Query(default="0", max_length=5),
    video: str = Query(default="0", max_length=5),
) -> None:
    manager: ConnectionManager = websocket.app.state.connection_manager

    # Accept first so rejections can carry an application close code and
    # reason; refusing the handshake would only surface as a generic 403.
    await websocket.accept()

    normalized = normalize_meeting_id(meeting_id)
    if normalized is None or not _CLIENT_ID_RE.fullmatch(client_id):
        await manager.close_quietly(
            websocket, CloseCode.BAD_REQUEST, "Invalid meeting or client id"
        )
        return

    snapshot = await run_in_threadpool(lifecycle.get_meeting_snapshot, normalized)
    if snapshot is None or snapshot.status == MeetingStatus.ENDED:
        await manager.close_quietly(
            websocket, CloseCode.NOT_FOUND, "Meeting not found or has ended"
        )
        return

    is_host = user_id is not None and user_id == snapshot.host_id
    if snapshot.passcode and not is_host:
        key = (websocket.client.host if websocket.client else "unknown", normalized)
        if passcode_limiter.retry_after(key):
            await manager.close_quietly(
                websocket, CloseCode.PASSCODE, "Too many passcode attempts"
            )
            return
        if not passcodes_match(passcode, snapshot.passcode):
            if passcode is not None:  # a missing code is not a guess
                passcode_limiter.record_failure(key)
            await manager.close_quietly(
                websocket, CloseCode.PASSCODE, "Passcode missing or incorrect"
            )
            return

    peer = Peer(
        client_id=client_id,
        display_name=name.strip() or "Guest",
        websocket=websocket,
        user_id=user_id,
        is_host=is_host,
        audio=_flag(audio),
        video=_flag(video),
    )

    try:
        room = await manager.connect(normalized, peer)
    except JoinRejected as rejection:
        await manager.close_quietly(websocket, rejection.code, rejection.reason)
        return

    try:
        await manager.send(peer, manager.room_state(room, peer))
        await manager.broadcast(
            room,
            make_envelope("user_joined", sender=client_id, payload=peer.public()),
            exclude={client_id},
        )
        await _receive_loop(manager, room, peer)
    finally:
        await manager.disconnect(room, peer)


async def _receive_loop(manager: ConnectionManager, room: Room, peer: Peer) -> None:
    websocket = peer.websocket
    while True:
        try:
            message = await asyncio.wait_for(
                websocket.receive(), timeout=settings.ws_idle_timeout_seconds
            )
        except asyncio.TimeoutError:
            await manager.close_quietly(websocket, CloseCode.IDLE_TIMEOUT, "Idle timeout")
            return
        except RuntimeError:
            return  # socket already closed

        if message["type"] == "websocket.disconnect":
            return

        raw = message.get("text")
        if raw is None:
            await manager.send_error(
                peer, "unsupported_frame", "Only text (JSON) frames are supported."
            )
            continue
        await _handle_frame(manager, room, peer, raw)


async def _handle_frame(manager: ConnectionManager, room: Room, peer: Peer, raw: str) -> None:
    if len(raw.encode("utf-8")) > settings.ws_max_message_bytes:
        await manager.send_error(peer, "message_too_large", "Message exceeds the size limit.")
        return

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        await manager.send_error(peer, "invalid_json", "Message is not valid JSON.")
        return

    if not isinstance(data, dict) or not isinstance(data.get("type"), str):
        await manager.send_error(peer, "invalid_message", "Expected an object with a string 'type'.")
        return

    payload = data.get("payload", {})
    if not isinstance(payload, dict):
        await manager.send_error(peer, "invalid_payload", "'payload' must be an object.")
        return

    msg_type: str = data["type"]
    if msg_type == "ping":
        await manager.send(peer, make_envelope("pong", to=peer.client_id))
    elif msg_type in _RELAY_TYPES:
        await _relay(manager, room, peer, msg_type, data, payload)
    elif msg_type == "chat_message":
        await _chat(manager, room, peer, payload)
    elif msg_type == "media_state":
        await _media_state(manager, room, peer, payload)
    elif msg_type == "screen_share":
        await _screen_share(manager, room, peer, payload)
    elif msg_type == "raise_hand":
        await _raise_hand(manager, room, peer, payload)
    elif msg_type == "reaction":
        await _reaction(manager, room, peer, payload)
    elif msg_type == "host_action":
        await _host_action(manager, room, peer, data, payload)
    elif msg_type in _SERVER_ONLY_TYPES:
        await manager.send_error(
            peer, "reserved_type", f"'{msg_type}' is sent by the server only."
        )
    else:
        await manager.send_error(peer, "unknown_type", f"Unknown message type '{msg_type}'.")


async def _relay(
    manager: ConnectionManager,
    room: Room,
    peer: Peer,
    msg_type: str,
    data: dict[str, Any],
    payload: dict[str, Any],
) -> None:
    """Forward SDP / ICE to exactly one peer (the mesh needs targeted delivery)."""
    target_id = data.get("to") or payload.get("to")
    target = room.peers.get(target_id) if isinstance(target_id, str) else None
    if target is None or target is peer:
        await manager.send_error(peer, "peer_not_found", "Target peer is not in this meeting.")
        return
    await manager.send(
        target,
        make_envelope(msg_type, sender=peer.client_id, to=target.client_id, payload=payload),
    )


async def _chat(
    manager: ConnectionManager, room: Room, peer: Peer, payload: dict[str, Any]
) -> None:
    text = payload.get("text")
    if not isinstance(text, str) or not text.strip():
        await manager.send_error(peer, "invalid_chat", "Chat message text is required.")
        return
    text = text.strip()
    if len(text) > settings.chat_max_length:
        await manager.send_error(
            peer, "chat_too_long", f"Messages are limited to {settings.chat_max_length} characters."
        )
        return
    if not manager.allow_chat(peer):
        await manager.send_error(peer, "rate_limited", "You are sending messages too quickly.")
        return

    message = {
        "id": str(uuid.uuid4()),
        "text": text,
        "sender_id": peer.client_id,
        "sender_name": peer.display_name,
        "is_host": peer.is_host,
    }
    envelope = make_envelope("chat_message", sender=peer.client_id, payload=message)
    message["ts"] = envelope["ts"]
    room.chat_history.append(message)
    # Sent to everyone including the sender, so every client renders the
    # same server-stamped message.
    await manager.broadcast(room, envelope)


async def _host_action(
    manager: ConnectionManager,
    room: Room,
    peer: Peer,
    data: dict[str, Any],
    payload: dict[str, Any],
) -> None:
    if not peer.is_host:
        await manager.send_error(peer, "forbidden", "Only the host can perform this action.")
        return

    action = payload.get("action")
    if action not in _HOST_ACTIONS:
        await manager.send_error(
            peer, "invalid_action", f"action must be one of: {', '.join(sorted(_HOST_ACTIONS))}."
        )
        return

    if action == "end_meeting":
        await manager.end_room(room, ended_by=peer)
        return

    if action == "mute_all":
        hosts = {cid for cid, p in room.peers.items() if p.is_host}
        await manager.broadcast(
            room,
            make_envelope("host_action", sender=peer.client_id, payload={"action": "mute_all"}),
            exclude=hosts,
        )
        return

    if action == "stop_share":
        sharer = room.peers.get(room.sharer_id) if room.sharer_id else None
        if sharer is None:
            await manager.send_error(peer, "no_active_share", "Nobody is sharing their screen.")
            return
        await manager.stop_share(room, sharer, "stopped_by_host")
        return

    # mute / kick need a target.
    target_id = payload.get("target_client_id") or data.get("to")
    target = room.peers.get(target_id) if isinstance(target_id, str) else None
    if target is None or target is peer or (action == "kick" and target.is_host):
        await manager.send_error(peer, "invalid_target", "Choose another participant in this meeting.")
        return

    await manager.send(
        target,
        make_envelope(
            "host_action",
            sender=peer.client_id,
            to=target.client_id,
            payload={"action": action},
        ),
    )
    if action == "kick":
        # Ban the client_id so a kicked browser cannot simply reconnect. (A
        # determined user can mint a new client_id; real auth would be needed
        # to prevent that.)
        room.banned.add(target.client_id)
        await manager.close_quietly(
            target.websocket, CloseCode.REMOVED_BY_HOST, "Removed by host"
        )


async def _media_state(
    manager: ConnectionManager, room: Room, peer: Peer, payload: dict[str, Any]
) -> None:
    audio, video = payload.get("audio"), payload.get("video")
    if not isinstance(audio, bool) or not isinstance(video, bool):
        await manager.send_error(
            peer, "invalid_media_state", "'audio' and 'video' must be booleans."
        )
        return
    peer.audio, peer.video = audio, video
    await manager.broadcast(
        room,
        make_envelope(
            "media_state", sender=peer.client_id, payload={"audio": audio, "video": video}
        ),
        exclude={peer.client_id},
    )


async def _screen_share(
    manager: ConnectionManager, room: Room, peer: Peer, payload: dict[str, Any]
) -> None:
    active = payload.get("active")
    if not isinstance(active, bool):
        await manager.send_error(peer, "invalid_screen_share", "'active' must be a boolean.")
        return

    if not active:
        # Only the current sharer can stop; anything else is a harmless no-op.
        await manager.stop_share(room, peer, "stopped", notify_sharer=False)
        return

    stream_id = payload.get("stream_id")
    if not isinstance(stream_id, str) or not 1 <= len(stream_id) <= 128:
        await manager.send_error(
            peer, "invalid_screen_share", "'stream_id' must be a non-empty string."
        )
        return

    current = room.peers.get(room.sharer_id) if room.sharer_id else None
    if current is not None and current is not peer:
        if payload.get("force") is not True:
            await manager.send_error(
                peer,
                "share_in_progress",
                "Someone else is already sharing their screen.",
                extra={"sharer_id": current.client_id, "sharer_name": current.display_name},
            )
            return
        # Replace: tell the old sharer only; everyone else learns from the new start.
        room.sharer_id = None
        current.screen_stream_id = None
        await manager.send(
            current,
            make_envelope(
                "screen_share",
                sender=current.client_id,
                to=current.client_id,
                payload={"active": False, "reason": "replaced"},
            ),
        )

    peer.screen_stream_id = stream_id
    room.sharer_id = peer.client_id
    await manager.broadcast(
        room,
        make_envelope(
            "screen_share",
            sender=peer.client_id,
            payload={"active": True, "stream_id": stream_id},
        ),
        exclude={peer.client_id},
    )


async def _raise_hand(
    manager: ConnectionManager, room: Room, peer: Peer, payload: dict[str, Any]
) -> None:
    raised = payload.get("raised")
    if not isinstance(raised, bool):
        await manager.send_error(peer, "invalid_raise_hand", "'raised' must be a boolean.")
        return

    target_id = payload.get("target_client_id")
    if target_id is None or target_id == peer.client_id:
        target = peer
    else:
        if not peer.is_host or raised:
            await manager.send_error(
                peer, "forbidden", "Only a host can lower another participant's hand."
            )
            return
        target = room.peers.get(target_id) if isinstance(target_id, str) else None
        if target is None:
            await manager.send_error(peer, "invalid_target", "Participant is not in this meeting.")
            return

    if raised:
        if target.hand_raised_at is None:  # keep the original time so ordering is stable
            target.hand_raised_at = utcnow()
    else:
        target.hand_raised_at = None
    await manager.broadcast(
        room,
        make_envelope(
            "raise_hand",
            sender=target.client_id,
            payload={"raised": raised, "hand_raised_at": iso_z(target.hand_raised_at)},
        ),
    )


async def _reaction(
    manager: ConnectionManager, room: Room, peer: Peer, payload: dict[str, Any]
) -> None:
    emoji = payload.get("emoji")
    if not isinstance(emoji, str) or emoji not in _REACTIONS:
        await manager.send_error(
            peer, "invalid_emoji", f"emoji must be one of: {' '.join(sorted(_REACTIONS))}"
        )
        return
    if not manager.allow_reaction(peer):
        await manager.send_error(peer, "rate_limited", "You are reacting too quickly.")
        return
    await manager.broadcast(
        room,
        make_envelope(
            "reaction", sender=peer.client_id, payload={"emoji": emoji, "id": str(uuid.uuid4())}
        ),
    )
