import re
from datetime import timedelta

from models import MeetingStatus
from utils import utcnow

ID_RE = re.compile(r"^\d{3}-\d{4}-\d{4}$")


def _future(hours: float = 2) -> str:
    return (utcnow() + timedelta(hours=hours)).isoformat()


# --------------------------------------------------------------------------- #
# POST /api/meetings/instant
# --------------------------------------------------------------------------- #
def test_instant_meeting_is_active_with_formatted_id(client):
    response = client.post("/api/meetings/instant", json={"host_id": "usr_default"})
    assert response.status_code == 201
    meeting = response.json()["meeting"]
    assert ID_RE.match(meeting["id"])
    assert meeting["title"] == "Instant Meeting"
    assert meeting["status"] == "active"
    assert meeting["host_id"] == "usr_default"
    assert len(meeting["passcode"]) == 6
    assert meeting["scheduled_start"].endswith("Z")


def test_instant_meeting_body_is_optional(client):
    response = client.post("/api/meetings/instant")
    assert response.status_code == 201
    assert response.json()["meeting"]["host_id"] == "usr_default"


def test_instant_meeting_unknown_host_is_404(client):
    response = client.post("/api/meetings/instant", json={"host_id": "nobody"})
    assert response.status_code == 404


def test_instant_meetings_get_distinct_ids(client):
    ids = {
        client.post("/api/meetings/instant").json()["meeting"]["id"] for _ in range(10)
    }
    assert len(ids) == 10


# --------------------------------------------------------------------------- #
# POST /api/meetings/schedule
# --------------------------------------------------------------------------- #
def test_schedule_meeting(client):
    response = client.post(
        "/api/meetings/schedule",
        json={
            "title": "  Planning  ",
            "description": "Quarterly planning",
            "scheduled_start": _future(),
            "duration_minutes": 45,
        },
    )
    assert response.status_code == 201
    meeting = response.json()["meeting"]
    assert ID_RE.match(meeting["id"])
    assert meeting["title"] == "Planning"
    assert meeting["status"] == "scheduled"
    assert meeting["duration_minutes"] == 45
    assert len(meeting["passcode"]) == 6  # auto-generated


def test_schedule_keeps_supplied_passcode(client):
    response = client.post(
        "/api/meetings/schedule",
        json={"title": "x", "scheduled_start": _future(), "passcode": "Secret99"},
    )
    assert response.json()["meeting"]["passcode"] == "Secret99"


def test_schedule_rejects_past_start(client):
    response = client.post(
        "/api/meetings/schedule",
        json={"title": "x", "scheduled_start": _future(-1)},
    )
    assert response.status_code == 422


def test_schedule_rejects_invalid_fields(client):
    start = _future()
    assert client.post("/api/meetings/schedule", json={"title": "", "scheduled_start": start}).status_code == 422
    assert (
        client.post(
            "/api/meetings/schedule",
            json={"title": "x", "scheduled_start": start, "duration_minutes": 0},
        ).status_code
        == 422
    )


# --------------------------------------------------------------------------- #
# GET /api/meetings/upcoming
# --------------------------------------------------------------------------- #
def test_upcoming_lists_scheduled_soonest_first(client, make_meeting):
    now = utcnow()
    make_meeting("111-1111-1111", status=MeetingStatus.SCHEDULED, scheduled_start=now + timedelta(hours=3))
    make_meeting("222-2222-2222", status=MeetingStatus.SCHEDULED, scheduled_start=now + timedelta(hours=1))
    make_meeting("333-3333-3333", status=MeetingStatus.ACTIVE, scheduled_start=now + timedelta(hours=2))
    make_meeting("444-4444-4444", status=MeetingStatus.ENDED, scheduled_start=now + timedelta(hours=2))

    response = client.get("/api/meetings/upcoming")
    assert response.status_code == 200
    assert [m["id"] for m in response.json()] == ["222-2222-2222", "111-1111-1111"]


def test_upcoming_keeps_late_meetings_but_drops_stale_ones(client, make_meeting):
    now = utcnow()
    make_meeting("111-1111-1111", status=MeetingStatus.SCHEDULED, scheduled_start=now - timedelta(minutes=20))
    make_meeting("222-2222-2222", status=MeetingStatus.SCHEDULED, scheduled_start=now - timedelta(days=3))

    ids = [m["id"] for m in client.get("/api/meetings/upcoming").json()]
    assert ids == ["111-1111-1111"]


def test_upcoming_respects_limit(client, make_meeting):
    now = utcnow()
    for i in range(3):
        make_meeting(f"11{i}-1111-1111", status=MeetingStatus.SCHEDULED, scheduled_start=now + timedelta(hours=i + 1))
    assert len(client.get("/api/meetings/upcoming?limit=2").json()) == 2


# --------------------------------------------------------------------------- #
# GET /api/meetings/recent
# --------------------------------------------------------------------------- #
def test_recent_lists_active_first_then_ended_newest_first(client, make_meeting):
    now = utcnow()
    make_meeting("111-1111-1111", status=MeetingStatus.ENDED, scheduled_start=now - timedelta(hours=5))
    make_meeting("222-2222-2222", status=MeetingStatus.ENDED, scheduled_start=now - timedelta(hours=1))
    make_meeting("333-3333-3333", status=MeetingStatus.ACTIVE, scheduled_start=now - timedelta(hours=9))
    make_meeting("444-4444-4444", status=MeetingStatus.SCHEDULED, scheduled_start=now + timedelta(hours=1))

    response = client.get("/api/meetings/recent")
    assert response.status_code == 200
    assert [m["id"] for m in response.json()] == [
        "333-3333-3333",
        "222-2222-2222",
        "111-1111-1111",
    ]


def test_fixed_paths_are_not_swallowed_by_the_id_route(client):
    assert isinstance(client.get("/api/meetings/upcoming").json(), list)
    assert isinstance(client.get("/api/meetings/recent").json(), list)


# --------------------------------------------------------------------------- #
# GET /api/meetings/{id}
# --------------------------------------------------------------------------- #
def test_lookup_hides_passcode_and_host_email(client, make_meeting):
    make_meeting("111-2222-3333", passcode="ABC123")
    body = client.get("/api/meetings/111-2222-3333").json()
    assert body["exists"] is True
    meeting = body["meeting"]
    assert meeting["passcode_required"] is True
    assert "passcode" not in meeting
    assert meeting["host"]["name"] == "Test Host"
    assert "email" not in meeting["host"]


def test_lookup_without_passcode(client, make_meeting):
    make_meeting("111-2222-3333", passcode=None)
    assert client.get("/api/meetings/111-2222-3333").json()["meeting"]["passcode_required"] is False


def test_lookup_accepts_unformatted_ids(client, make_meeting):
    make_meeting("111-2222-3333")
    for raw in ("11122223333", "111 2222 3333", "111-2222-3333"):
        body = client.get(f"/api/meetings/{raw}").json()
        assert body["exists"] is True
        assert body["meeting"]["id"] == "111-2222-3333"


def test_lookup_unknown_or_malformed_id_returns_exists_false(client):
    for raw in ("999-9999-9999", "not-an-id", "123"):
        response = client.get(f"/api/meetings/{raw}")
        assert response.status_code == 200
        assert response.json() == {"exists": False, "meeting": None}


def test_lookup_ended_meeting_still_exists(client, make_meeting):
    make_meeting("111-2222-3333", status=MeetingStatus.ENDED)
    body = client.get("/api/meetings/111-2222-3333").json()
    assert body["exists"] is True
    assert body["meeting"]["status"] == "ended"
