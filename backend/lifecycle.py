"""Synchronous database helpers that keep meeting state in sync with the
WebSocket layer.

Each function opens its own short-lived session. WebSocket handlers are
long-lived, so they must never hold a request-scoped session open; they call
these through ``run_in_threadpool`` so SQLite I/O never blocks the event loop.
"""

from dataclasses import dataclass

from sqlalchemy import update

from database import SessionLocal
from models import Meeting, MeetingParticipant, MeetingStatus
from utils import utcnow


@dataclass(frozen=True)
class MeetingSnapshot:
    id: str
    title: str
    host_id: str
    status: MeetingStatus


def get_meeting_snapshot(meeting_id: str) -> MeetingSnapshot | None:
    with SessionLocal() as db:
        meeting = db.get(Meeting, meeting_id)
        if meeting is None:
            return None
        return MeetingSnapshot(
            id=meeting.id,
            title=meeting.title,
            host_id=meeting.host_id,
            status=meeting.status,
        )


def register_join(meeting_id: str, display_name: str, is_host: bool) -> str | None:
    """Record a participant and activate a scheduled meeting.

    Returns the new participant row id, or ``None`` if the meeting does not
    exist or has already ended.
    """
    with SessionLocal() as db:
        meeting = db.get(Meeting, meeting_id)
        if meeting is None or meeting.status == MeetingStatus.ENDED:
            return None
        if meeting.status == MeetingStatus.SCHEDULED:
            meeting.status = MeetingStatus.ACTIVE
        participant = MeetingParticipant(
            meeting_id=meeting_id,
            user_display_name=display_name,
            is_host=is_host,
        )
        db.add(participant)
        db.commit()
        return participant.id


def register_leave(participant_id: str) -> None:
    """Stamp ``left_at`` once; calling it again is a no-op."""
    with SessionLocal() as db:
        db.execute(
            update(MeetingParticipant)
            .where(
                MeetingParticipant.id == participant_id,
                MeetingParticipant.left_at.is_(None),
            )
            .values(left_at=utcnow())
        )
        db.commit()


def end_meeting(meeting_id: str) -> bool:
    """Mark the meeting ended and close every still-open participant row."""
    with SessionLocal() as db:
        meeting = db.get(Meeting, meeting_id)
        if meeting is None:
            return False
        meeting.status = MeetingStatus.ENDED
        db.execute(
            update(MeetingParticipant)
            .where(
                MeetingParticipant.meeting_id == meeting_id,
                MeetingParticipant.left_at.is_(None),
            )
            .values(left_at=utcnow())
        )
        db.commit()
        return True
