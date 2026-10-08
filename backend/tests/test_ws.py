"""WebSocket signalling and lifecycle tests.

TestClient WebSocket sessions do not wait for server-side cleanup when their
``with`` block exits, so assertions about state written during disconnect use
``wait_for`` to poll instead of checking immediately.
"""

import time

import pytest
from starlette.websockets import WebSocketDisconnect

from config import settings
from database import SessionLocal
from models import Meeting, MeetingParticipant, MeetingStatus

MID = "111-2222-3333"


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def ws_path(client_id, *, user_id=None, name=None, meeting_id=MID):
    params = []
    if name:
        params.append(f"name={name}")
    if user_id:
        params.append(f"user_id={user_id}")
    query = f"?{'&'.join(params)}" if params else ""
    return f"/ws/meeting/{meeting_id}/{client_id}{query}"


def host_path(client_id="host"):
    return ws_path(client_id, user_id="usr_default", name="Host")


def guest_path(client_id, name="Guest"):
    return ws_path(client_id, name=name)


def meeting_status(meeting_id=MID):
    with SessionLocal() as db:
        return db.get(Meeting, meeting_id).status


def participants(meeting_id=MID):
    with SessionLocal() as db:
        rows = (
            db.query(
                MeetingParticipant.user_display_name,
                MeetingParticipant.is_host,
                MeetingParticipant.left_at,
            )
            .filter(MeetingParticipant.meeting_id == meeting_id)
            .order_by(MeetingParticipant.joined_at)
            .all()
        )
        return [tuple(row) for row in rows]


def wait_for(predicate, timeout=5.0, interval=0.05):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return predicate()


def assert_closed_with(ws, code):
    with pytest.raises(WebSocketDisconnect) as exc:
        ws.receive_json()
    assert exc.value.code == code


# --------------------------------------------------------------------------- #
# Joining
# --------------------------------------------------------------------------- #
def test_host_receives_room_state_with_host_flag(client, make_meeting):
    make_meeting()
    with client.websocket_connect(host_path()) as ws:
        message = ws.receive_json()
        assert message["type"] == "room_state"
        assert message["payload"]["self"] == {
            "client_id": "host",
            "display_name": "Host",
            "is_host": True,
        }
        assert message["payload"]["peers"] == []
        assert message["payload"]["max_participants"] == settings.max_room_participants


def test_guest_join_and_leave_are_announced(client, make_meeting):
    make_meeting()
    with client.websocket_connect(host_path()) as host:
        host.receive_json()  # room_state
        with client.websocket_connect(guest_path("g1", "Gina")) as guest:
            state = guest.receive_json()
            assert state["payload"]["self"]["is_host"] is False
            assert [p["client_id"] for p in state["payload"]["peers"]] == ["host"]

            joined = host.receive_json()
            assert joined["type"] == "user_joined"
            assert joined["from"] == "g1"
            assert joined["payload"]["display_name"] == "Gina"
        left = host.receive_json()
        assert left["type"] == "user_left"
        assert left["from"] == "g1"


def test_unknown_meeting_is_rejected_with_4004(client):
    with client.websocket_connect(ws_path("c1", meeting_id="999-9999-9999")) as ws:
        assert_closed_with(ws, 4004)


def test_ended_meeting_is_rejected_with_4004(client, make_meeting):
    make_meeting(status=MeetingStatus.ENDED)
    with client.websocket_connect(guest_path("c1")) as ws:
        assert_closed_with(ws, 4004)


def test_malformed_ids_are_rejected_with_4400(client, make_meeting):
    make_meeting()
    with client.websocket_connect(ws_path("c1", meeting_id="abc")) as ws:
        assert_closed_with(ws, 4400)
    with client.websocket_connect(ws_path("bad!id")) as ws:
        assert_closed_with(ws, 4400)


def test_room_cap_is_enforced(client, make_meeting, monkeypatch):
    monkeypatch.setattr(settings, "max_room_participants", 2)
    make_meeting()
    with client.websocket_connect(host_path()) as host:
        host.receive_json()
        with client.websocket_connect(guest_path("g1")) as guest:
            guest.receive_json()
            with client.websocket_connect(guest_path("g2")) as extra:
                assert_closed_with(extra, 4008)


def test_same_client_id_replaces_the_old_connection(client, make_meeting):
    make_meeting()
    with client.websocket_connect(host_path("same")) as first:
        first.receive_json()
        with client.websocket_connect(host_path("same")) as second:
            state = second.receive_json()
            assert state["payload"]["peers"] == []
            assert_closed_with(first, 4009)

            second.send_json({"type": "ping"})
            assert second.receive_json()["type"] == "pong"


# --------------------------------------------------------------------------- #
# Signalling relay
# --------------------------------------------------------------------------- #
def test_offers_are_targeted_and_sender_is_stamped_by_the_server(client, make_meeting):
    make_meeting()
    with (
        client.websocket_connect(host_path("a")) as a,
        client.websocket_connect(guest_path("b")) as b,
        client.websocket_connect(guest_path("c")) as c,
    ):
        a.receive_json()  # room_state
        a.receive_json()  # user_joined b
        a.receive_json()  # user_joined c
        b.receive_json()  # room_state
        b.receive_json()  # user_joined c
        c.receive_json()  # room_state

        b.send_json(
            {"type": "offer", "to": "a", "from": "spoofed", "payload": {"sdp": "v=0"}}
        )
        offer = a.receive_json()
        assert offer["type"] == "offer"
        assert offer["from"] == "b"
        assert offer["to"] == "a"
        assert offer["payload"] == {"sdp": "v=0"}

        # c must not have seen the offer: its next message is this broadcast.
        a.send_json({"type": "chat_message", "payload": {"text": "hi"}})
        assert c.receive_json()["type"] == "chat_message"


@pytest.mark.parametrize("msg_type", ["answer", "candidate"])
def test_answer_and_candidate_are_relayed(client, make_meeting, msg_type):
    make_meeting()
    with client.websocket_connect(host_path("a")) as a, client.websocket_connect(guest_path("b")) as b:
        a.receive_json()
        a.receive_json()  # user_joined b
        b.receive_json()

        a.send_json({"type": msg_type, "to": "b", "payload": {"data": 1}})
        message = b.receive_json()
        assert message["type"] == msg_type
        assert message["from"] == "a"
        assert message["payload"] == {"data": 1}


def test_relay_to_missing_peer_is_an_error_not_a_crash(client, make_meeting):
    make_meeting()
    with client.websocket_connect(host_path()) as ws:
        ws.receive_json()
        ws.send_json({"type": "offer", "to": "ghost", "payload": {}})
        error = ws.receive_json()
        assert error["type"] == "error"
        assert error["payload"]["code"] == "peer_not_found"


# --------------------------------------------------------------------------- #
# Protocol hardening
# --------------------------------------------------------------------------- #
def test_bad_frames_produce_errors_and_keep_the_socket_open(client, make_meeting):
    make_meeting()
    with client.websocket_connect(host_path()) as ws:
        ws.receive_json()

        ws.send_text("not json")
        assert ws.receive_json()["payload"]["code"] == "invalid_json"

        ws.send_json({"type": "teleport"})
        assert ws.receive_json()["payload"]["code"] == "unknown_type"

        ws.send_json({"type": "user_joined"})
        assert ws.receive_json()["payload"]["code"] == "reserved_type"

        ws.send_json({"type": "chat_message", "payload": "oops"})
        assert ws.receive_json()["payload"]["code"] == "invalid_payload"

        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"


def test_oversized_frames_are_rejected(client, make_meeting, monkeypatch):
    monkeypatch.setattr(settings, "ws_max_message_bytes", 100)
    make_meeting()
    with client.websocket_connect(host_path()) as ws:
        ws.receive_json()
        ws.send_text("x" * 500)
        assert ws.receive_json()["payload"]["code"] == "message_too_large"


# --------------------------------------------------------------------------- #
# Chat
# --------------------------------------------------------------------------- #
def test_chat_is_broadcast_to_everyone_including_sender(client, make_meeting):
    make_meeting()
    with client.websocket_connect(host_path()) as host, client.websocket_connect(guest_path("g1", "Gina")) as guest:
        host.receive_json()
        host.receive_json()  # user_joined
        guest.receive_json()

        guest.send_json({"type": "chat_message", "payload": {"text": "  hello  "}})
        for ws in (host, guest):
            message = ws.receive_json()
            assert message["type"] == "chat_message"
            assert message["payload"]["text"] == "hello"
            assert message["payload"]["sender_id"] == "g1"
            assert message["payload"]["sender_name"] == "Gina"
            assert message["payload"]["id"]


def test_late_joiners_receive_chat_history(client, make_meeting):
    make_meeting()
    with client.websocket_connect(host_path()) as host:
        host.receive_json()
        host.send_json({"type": "chat_message", "payload": {"text": "first"}})
        host.receive_json()  # own echo

        with client.websocket_connect(guest_path("g1")) as guest:
            history = guest.receive_json()["payload"]["chat_history"]
            assert [m["text"] for m in history] == ["first"]


def test_chat_validation_and_rate_limit(client, make_meeting, monkeypatch):
    monkeypatch.setattr(settings, "chat_max_length", 10)
    monkeypatch.setattr(settings, "chat_rate_limit_count", 2)
    make_meeting()
    with client.websocket_connect(host_path()) as ws:
        ws.receive_json()

        ws.send_json({"type": "chat_message", "payload": {"text": "   "}})
        assert ws.receive_json()["payload"]["code"] == "invalid_chat"

        ws.send_json({"type": "chat_message", "payload": {"text": "x" * 11}})
        assert ws.receive_json()["payload"]["code"] == "chat_too_long"

        for _ in range(2):
            ws.send_json({"type": "chat_message", "payload": {"text": "ok"}})
            assert ws.receive_json()["type"] == "chat_message"
        ws.send_json({"type": "chat_message", "payload": {"text": "ok"}})
        assert ws.receive_json()["payload"]["code"] == "rate_limited"


# --------------------------------------------------------------------------- #
# Host actions
# --------------------------------------------------------------------------- #
def test_guests_cannot_use_host_actions(client, make_meeting):
    make_meeting()
    with client.websocket_connect(host_path()) as host, client.websocket_connect(guest_path("g1")) as guest:
        host.receive_json()
        host.receive_json()
        guest.receive_json()

        guest.send_json(
            {"type": "host_action", "payload": {"action": "mute", "target_client_id": "host"}}
        )
        error = guest.receive_json()
        assert error["type"] == "error"
        assert error["payload"]["code"] == "forbidden"


def test_host_can_mute_one_participant(client, make_meeting):
    make_meeting()
    with client.websocket_connect(host_path()) as host, client.websocket_connect(guest_path("g1")) as guest:
        host.receive_json()
        host.receive_json()
        guest.receive_json()

        host.send_json(
            {"type": "host_action", "payload": {"action": "mute", "target_client_id": "g1"}}
        )
        message = guest.receive_json()
        assert message["type"] == "host_action"
        assert message["from"] == "host"
        assert message["payload"] == {"action": "mute"}


def test_mute_all_reaches_guests_but_not_the_host(client, make_meeting):
    make_meeting()
    with (
        client.websocket_connect(host_path()) as host,
        client.websocket_connect(guest_path("g1")) as g1,
        client.websocket_connect(guest_path("g2")) as g2,
    ):
        host.receive_json()
        host.receive_json()  # user_joined g1
        host.receive_json()  # user_joined g2
        g1.receive_json()
        g1.receive_json()  # user_joined g2
        g2.receive_json()

        host.send_json({"type": "host_action", "payload": {"action": "mute_all"}})
        for guest in (g1, g2):
            assert guest.receive_json()["payload"] == {"action": "mute_all"}

        # The host's next message is this ping reply, not a mute_all echo.
        host.send_json({"type": "ping"})
        assert host.receive_json()["type"] == "pong"


def test_host_can_kick_and_the_kicked_client_cannot_rejoin(client, make_meeting):
    make_meeting()
    with client.websocket_connect(host_path()) as host:
        host.receive_json()
        with client.websocket_connect(guest_path("g1")) as guest:
            guest.receive_json()
            host.receive_json()  # user_joined

            host.send_json(
                {"type": "host_action", "payload": {"action": "kick", "target_client_id": "g1"}}
            )
            notice = guest.receive_json()
            assert notice["type"] == "host_action"
            assert notice["payload"]["action"] == "kick"
            assert_closed_with(guest, 4003)

            assert host.receive_json()["type"] == "user_left"

        with client.websocket_connect(guest_path("g1")) as again:
            assert_closed_with(again, 4003)


def test_host_cannot_kick_themselves(client, make_meeting):
    make_meeting()
    with client.websocket_connect(host_path()) as host:
        host.receive_json()
        host.send_json(
            {"type": "host_action", "payload": {"action": "kick", "target_client_id": "host"}}
        )
        assert host.receive_json()["payload"]["code"] == "invalid_target"


def test_end_meeting_closes_everyone_and_marks_it_ended(client, make_meeting):
    make_meeting()
    with client.websocket_connect(host_path()) as host, client.websocket_connect(guest_path("g1")) as guest:
        host.receive_json()
        host.receive_json()  # user_joined
        guest.receive_json()

        host.send_json({"type": "host_action", "payload": {"action": "end_meeting"}})
        for ws in (host, guest):
            assert ws.receive_json()["payload"]["action"] == "end_meeting"
        for ws in (host, guest):
            assert_closed_with(ws, 4001)

    assert meeting_status() == MeetingStatus.ENDED
    with client.websocket_connect(guest_path("late")) as late:
        assert_closed_with(late, 4004)


# --------------------------------------------------------------------------- #
# Database lifecycle
# --------------------------------------------------------------------------- #
def test_first_join_activates_scheduled_meeting_and_records_participants(client, make_meeting):
    make_meeting(status=MeetingStatus.SCHEDULED)
    assert meeting_status() == MeetingStatus.SCHEDULED

    with client.websocket_connect(host_path()) as ws:
        ws.receive_json()
        assert meeting_status() == MeetingStatus.ACTIVE
        rows = participants()
        assert len(rows) == 1
        assert rows[0][0] == "Host"
        assert rows[0][1] is True  # is_host
        assert rows[0][2] is None  # still in the meeting

    assert wait_for(lambda: participants()[0][2] is not None)


def test_a_meeting_nobody_joins_is_never_ended(client, make_meeting, monkeypatch):
    monkeypatch.setattr(settings, "empty_room_grace_seconds", 0.1)
    make_meeting("111-2222-3333", status=MeetingStatus.SCHEDULED)
    make_meeting("444-5555-6666", status=MeetingStatus.ACTIVE)
    time.sleep(0.6)
    assert meeting_status("111-2222-3333") == MeetingStatus.SCHEDULED
    assert meeting_status("444-5555-6666") == MeetingStatus.ACTIVE


def test_meeting_ends_after_the_empty_room_grace_period(client, make_meeting, monkeypatch):
    monkeypatch.setattr(settings, "empty_room_grace_seconds", 0.3)
    make_meeting(status=MeetingStatus.SCHEDULED)

    with client.websocket_connect(host_path()) as ws:
        ws.receive_json()

    assert wait_for(lambda: meeting_status() == MeetingStatus.ENDED)
    assert wait_for(lambda: participants()[0][2] is not None)


def test_rejoining_within_the_grace_period_keeps_the_meeting_active(client, make_meeting, monkeypatch):
    monkeypatch.setattr(settings, "empty_room_grace_seconds", 1.0)
    make_meeting()

    with client.websocket_connect(host_path("first")) as ws:
        ws.receive_json()

    with client.websocket_connect(host_path("second")) as ws:
        ws.receive_json()
        time.sleep(1.5)  # well past the original deadline
        assert meeting_status() == MeetingStatus.ACTIVE
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"
