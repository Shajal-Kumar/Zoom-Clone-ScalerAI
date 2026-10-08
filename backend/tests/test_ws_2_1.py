"""Module 2.1: passcode verification/enforcement and the new signalling types.

Self-contained: builds its own TestClient (REST and WebSocket) and creates
meetings through the public API, so it does not depend on other fixtures.
"""

import os
import tempfile
from contextlib import ExitStack
from urllib.parse import urlencode

os.environ.setdefault("ZOOM_DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/test_2_1.db")

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import lifecycle
from database import SessionLocal
from main import app
from models import Meeting
from passcode import passcode_limiter

HOST = {"user_id": "usr_default"}


@pytest.fixture()
def client():
    passcode_limiter.clear()
    with TestClient(app) as c:
        yield c
    passcode_limiter.clear()


@pytest.fixture()
def meeting(client):
    res = client.post("/api/meetings/instant", json={})
    assert res.status_code == 201
    return res.json()["meeting"]


def ws_url(m, cid, **query):
    return f"/ws/meeting/{m['id']}/{cid}?" + urlencode({"name": cid, **query})


def recv(ws, msg_type, limit=30):
    """Next message of ``msg_type`` (skipping others)."""
    for _ in range(limit):
        msg = ws.receive_json()
        if msg["type"] == msg_type:
            return msg
    raise AssertionError(f"no {msg_type!r} message received")


def join(stack, client, m, cid, **query):
    ws = stack.enter_context(client.websocket_connect(ws_url(m, cid, **query)))
    state = recv(ws, "room_state")
    return ws, state


def expect_close(client, url, code):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(url) as ws:
            ws.receive_json()
    assert exc.value.code == code


# ----------------------------- REST verify ---------------------------------- #
def verify(client, m, code):
    return client.post(f"/api/meetings/{m['id']}/verify-passcode", json={"passcode": code})


def test_verify_correct_is_case_and_space_insensitive(client, meeting):
    res = verify(client, meeting, f"  {meeting['passcode'].lower()} ")
    assert res.status_code == 200
    assert res.json() == {"valid": True, "reason": None}


def test_verify_wrong(client, meeting):
    assert verify(client, meeting, "WRONG1").json() == {"valid": False, "reason": "incorrect"}


def test_verify_unknown_and_malformed(client):
    for mid in ("999-9999-9999", "nonsense"):
        res = client.post(f"/api/meetings/{mid}/verify-passcode", json={"passcode": "x"})
        assert res.status_code == 200
        assert res.json()["reason"] == "not_found"


def test_verify_ended(client, meeting):
    lifecycle.end_meeting(meeting["id"])
    assert verify(client, meeting, meeting["passcode"]).json() == {"valid": False, "reason": "ended"}


def test_verify_meeting_without_passcode(client, meeting):
    with SessionLocal() as db:
        db.get(Meeting, meeting["id"]).passcode = None
        db.commit()
    assert verify(client, meeting, "").json() == {"valid": True, "reason": None}


def test_verify_rate_limited_after_five_failures(client, meeting):
    for _ in range(5):
        assert verify(client, meeting, "BAD111").status_code == 200
    blocked = verify(client, meeting, "BAD111")
    assert blocked.status_code == 429
    assert "Retry-After" in blocked.headers
    # Even the right code is refused while blocked.
    assert verify(client, meeting, meeting["passcode"]).status_code == 429


# --------------------------- WS passcode gate ------------------------------- #
def test_ws_missing_or_wrong_passcode_closes_4005(client, meeting):
    expect_close(client, ws_url(meeting, "g1"), 4005)
    expect_close(client, ws_url(meeting, "g1", passcode="NOPE99"), 4005)


def test_ws_correct_passcode_admits_guest(client, meeting):
    with ExitStack() as st:
        _, state = join(st, client, meeting, "g1", passcode=meeting["passcode"].lower())
    assert state["payload"]["self"]["is_host"] is False


def test_ws_host_bypasses_passcode(client, meeting):
    with ExitStack() as st:
        _, state = join(st, client, meeting, "h1", **HOST)
    assert state["payload"]["self"]["is_host"] is True


def test_ws_wrong_guesses_share_the_rest_limiter(client, meeting):
    for _ in range(5):
        expect_close(client, ws_url(meeting, "g1", passcode="NOPE99"), 4005)
    assert verify(client, meeting, meeting["passcode"]).status_code == 429


# ------------------------------ media_state --------------------------------- #
def test_initial_media_state_from_query(client, meeting):
    with ExitStack() as st:
        _, state = join(st, client, meeting, "h1", audio="1", video="0", **HOST)
    me = state["payload"]["self"]
    assert (me["audio"], me["video"]) == (True, False)
    assert me["is_sharing"] is False and me["hand_raised_at"] is None


def test_media_state_is_relayed_and_validated(client, meeting):
    with ExitStack() as st:
        a, _ = join(st, client, meeting, "a1", **HOST)
        b, _ = join(st, client, meeting, "b1", passcode=meeting["passcode"])
        recv(a, "user_joined")
        b.send_json({"type": "media_state", "payload": {"audio": True, "video": True}})
        msg = recv(a, "media_state")
        assert msg["from"] == "b1" and msg["payload"] == {"audio": True, "video": True}
        b.send_json({"type": "media_state", "payload": {"audio": "yes", "video": True}})
        assert recv(b, "error")["payload"]["code"] == "invalid_media_state"


# ----------------------------- screen_share --------------------------------- #
def test_screen_share_single_sharer_force_and_late_joiner(client, meeting):
    code = meeting["passcode"]
    with ExitStack() as st:
        a, _ = join(st, client, meeting, "a1", **HOST)
        b, _ = join(st, client, meeting, "b1", passcode=code)
        recv(a, "user_joined")

        a.send_json({"type": "screen_share", "payload": {"active": True, "stream_id": "s-a"}})
        started = recv(b, "screen_share")
        assert started["from"] == "a1"
        assert started["payload"] == {"active": True, "stream_id": "s-a"}

        # A late joiner learns about the share from room_state.
        _, late = join(st, client, meeting, "c1", passcode=code)
        sharer = next(p for p in late["payload"]["peers"] if p["client_id"] == "a1")
        assert sharer["is_sharing"] and sharer["screen_stream_id"] == "s-a"

        # Second sharer is refused without force...
        b.send_json({"type": "screen_share", "payload": {"active": True, "stream_id": "s-b"}})
        err = recv(b, "error")
        assert err["payload"]["code"] == "share_in_progress"
        assert err["payload"]["sharer_id"] == "a1"

        # ...and replaces the first one with force.
        b.send_json(
            {"type": "screen_share", "payload": {"active": True, "stream_id": "s-b", "force": True}}
        )
        assert recv(a, "screen_share")["payload"] == {"active": False, "reason": "replaced"}
        assert recv(a, "screen_share")["payload"] == {"active": True, "stream_id": "s-b"}


def test_sharer_leaving_stops_share(client, meeting):
    with ExitStack() as st:
        b, _ = join(st, client, meeting, "b1", passcode=meeting["passcode"])
        with ExitStack() as inner:
            a, _ = join(inner, client, meeting, "a1", **HOST)
            recv(b, "user_joined")
            a.send_json({"type": "screen_share", "payload": {"active": True, "stream_id": "s-a"}})
            recv(b, "screen_share")
        stopped = recv(b, "screen_share")
        assert stopped["from"] == "a1"
        assert stopped["payload"] == {"active": False, "reason": "left"}


def test_sharer_can_stop_their_own_share(client, meeting):
    with ExitStack() as st:
        a, _ = join(st, client, meeting, "a1", **HOST)
        b, _ = join(st, client, meeting, "b1", passcode=meeting["passcode"])
        recv(a, "user_joined")
        a.send_json({"type": "screen_share", "payload": {"active": True, "stream_id": "s-a"}})
        recv(b, "screen_share")
        a.send_json({"type": "screen_share", "payload": {"active": False}})
        assert recv(b, "screen_share")["payload"] == {"active": False, "reason": "stopped"}


def test_host_stop_share_and_guest_forbidden(client, meeting):
    with ExitStack() as st:
        h, _ = join(st, client, meeting, "h1", **HOST)
        g, _ = join(st, client, meeting, "g1", passcode=meeting["passcode"])
        recv(h, "user_joined")
        g.send_json({"type": "screen_share", "payload": {"active": True, "stream_id": "s-g"}})
        recv(h, "screen_share")

        g.send_json({"type": "host_action", "payload": {"action": "stop_share"}})
        assert recv(g, "error")["payload"]["code"] == "forbidden"

        h.send_json({"type": "host_action", "payload": {"action": "stop_share"}})
        for ws in (h, g):
            msg = recv(ws, "screen_share")
            assert msg["from"] == "g1"
            assert msg["payload"] == {"active": False, "reason": "stopped_by_host"}

        h.send_json({"type": "host_action", "payload": {"action": "stop_share"}})
        assert recv(h, "error")["payload"]["code"] == "no_active_share"


# ------------------------------ raise_hand ---------------------------------- #
def test_raise_hand_and_host_lowering(client, meeting):
    with ExitStack() as st:
        h, _ = join(st, client, meeting, "h1", **HOST)
        g, _ = join(st, client, meeting, "g1", passcode=meeting["passcode"])
        recv(h, "user_joined")

        g.send_json({"type": "raise_hand", "payload": {"raised": True}})
        for ws in (h, g):
            msg = recv(ws, "raise_hand")
            assert msg["from"] == "g1" and msg["payload"]["raised"] is True
            assert msg["payload"]["hand_raised_at"].endswith("Z")

        # Guest may not touch the host's hand; host may lower the guest's.
        g.send_json({"type": "raise_hand", "payload": {"raised": False, "target_client_id": "h1"}})
        assert recv(g, "error")["payload"]["code"] == "forbidden"

        h.send_json({"type": "raise_hand", "payload": {"raised": False, "target_client_id": "g1"}})
        msg = recv(g, "raise_hand")
        assert msg["from"] == "g1"
        assert msg["payload"] == {"raised": False, "hand_raised_at": None}

        # Hosts can lower others but not raise them; bad payloads are rejected.
        h.send_json({"type": "raise_hand", "payload": {"raised": True, "target_client_id": "g1"}})
        assert recv(h, "error")["payload"]["code"] == "forbidden"
        g.send_json({"type": "raise_hand", "payload": {"raised": "up"}})
        assert recv(g, "error")["payload"]["code"] == "invalid_raise_hand"


# ------------------------------- reaction ----------------------------------- #
def test_reaction_reaches_everyone_including_sender(client, meeting):
    with ExitStack() as st:
        a, _ = join(st, client, meeting, "a1", **HOST)
        b, _ = join(st, client, meeting, "b1", passcode=meeting["passcode"])
        recv(a, "user_joined")
        a.send_json({"type": "reaction", "payload": {"emoji": "👍"}})
        for ws in (a, b):
            msg = recv(ws, "reaction")
            assert msg["from"] == "a1"
            assert msg["payload"]["emoji"] == "👍" and msg["payload"]["id"]


def test_reaction_invalid_emoji_and_rate_limit(client, meeting):
    with ExitStack() as st:
        a, _ = join(st, client, meeting, "a1", **HOST)
        a.send_json({"type": "reaction", "payload": {"emoji": "💩"}})
        assert recv(a, "error")["payload"]["code"] == "invalid_emoji"

        for _ in range(6):
            a.send_json({"type": "reaction", "payload": {"emoji": "🎉"}})
        results = [a.receive_json() for _ in range(6)]
        assert [m["type"] for m in results].count("reaction") == 5
        assert results[-1]["type"] == "error"
        assert results[-1]["payload"]["code"] == "rate_limited"


# --------------------------- duplicate connection --------------------------- #
def test_replaced_sharer_clears_share(client, meeting):
    with ExitStack() as st:
        b, _ = join(st, client, meeting, "b1", passcode=meeting["passcode"])
        a, _ = join(st, client, meeting, "a1", **HOST)
        recv(b, "user_joined")
        a.send_json({"type": "screen_share", "payload": {"active": True, "stream_id": "s-a"}})
        recv(b, "screen_share")
        join(st, client, meeting, "a1", **HOST)  # second tab, same client_id
        stopped = recv(b, "screen_share")
        assert stopped["payload"] == {"active": False, "reason": "left"}
