"""Meeting REST endpoints (all under ``/api/meetings``).

Route order matters: the fixed paths ``/upcoming`` and ``/recent`` are declared
before ``/{meeting_id}`` so the path parameter cannot swallow them.
"""

from collections.abc import Callable
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status
from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from models import Meeting, MeetingStatus, User
from schemas import (
    InstantMeetingCreate,
    MeetingEnvelope,
    MeetingExistsResponse,
    MeetingPublicResponse,
    MeetingResponse,
    MeetingScheduleCreate,
)
from utils import (
    generate_passcode,
    generate_unique_meeting_id,
    normalize_meeting_id,
    utcnow,
)

router = APIRouter(prefix="/api/meetings", tags=["meetings"])

_MAX_ID_ATTEMPTS = 5


def _require_host(db: Session, host_id: str) -> User:
    host = db.get(User, host_id)
    if host is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Host user not found"
        )
    return host


def _insert_with_unique_id(db: Session, build: Callable[[str], Meeting]) -> Meeting:
    """Insert a meeting, retrying if a concurrent request grabs the same ID.

    The pre-check in ``generate_unique_meeting_id`` is only an optimisation;
    the primary-key constraint is what actually guarantees uniqueness.
    """
    for _ in range(_MAX_ID_ATTEMPTS):
        meeting = build(generate_unique_meeting_id(db))
        db.add(meeting)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            continue
        db.refresh(meeting)  # also loads the eager host relationship
        return meeting
    raise HTTPException(
        status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Could not allocate a meeting ID, please retry.",
    )


@router.post(
    "/instant",
    response_model=MeetingEnvelope,
    status_code=http_status.HTTP_201_CREATED,
    summary="Create an instant (already active) meeting",
)
def create_instant_meeting(
    body: InstantMeetingCreate | None = None,
    db: Session = Depends(get_db),
) -> MeetingEnvelope:
    body = body or InstantMeetingCreate()
    host = _require_host(db, body.host_id)

    meeting = _insert_with_unique_id(
        db,
        lambda meeting_id: Meeting(
            id=meeting_id,
            title=body.title,
            host_id=host.id,
            status=MeetingStatus.ACTIVE,
            scheduled_start=utcnow(),
            passcode=generate_passcode(),
        ),
    )
    return MeetingEnvelope(meeting=MeetingResponse.model_validate(meeting))


@router.post(
    "/schedule",
    response_model=MeetingEnvelope,
    status_code=http_status.HTTP_201_CREATED,
    summary="Schedule a future meeting",
)
def schedule_meeting(
    body: MeetingScheduleCreate,
    db: Session = Depends(get_db),
) -> MeetingEnvelope:
    host = _require_host(db, body.host_id)

    meeting = _insert_with_unique_id(
        db,
        lambda meeting_id: Meeting(
            id=meeting_id,
            title=body.title,
            description=body.description,
            host_id=host.id,
            status=MeetingStatus.SCHEDULED,
            scheduled_start=body.scheduled_start,
            duration_minutes=body.duration_minutes,
            passcode=body.passcode or generate_passcode(),
        ),
    )
    return MeetingEnvelope(meeting=MeetingResponse.model_validate(meeting))


@router.get(
    "/upcoming",
    response_model=list[MeetingResponse],
    summary="Scheduled meetings, soonest first",
)
def list_upcoming(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> list[Meeting]:
    # Scheduled meetings never expire by themselves; keep them listed for a
    # while after their start time so a late host can still find them.
    earliest = utcnow() - timedelta(hours=settings.upcoming_grace_hours)
    stmt = (
        select(Meeting)
        .where(
            Meeting.status == MeetingStatus.SCHEDULED,
            Meeting.scheduled_start >= earliest,
        )
        .order_by(Meeting.scheduled_start.asc())
        .limit(limit)
    )
    return list(db.scalars(stmt).unique().all())


@router.get(
    "/recent",
    response_model=list[MeetingResponse],
    summary="Active and ended meetings, live ones first",
)
def list_recent(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> list[Meeting]:
    live_first = case((Meeting.status == MeetingStatus.ACTIVE, 0), else_=1)
    stmt = (
        select(Meeting)
        .where(Meeting.status.in_([MeetingStatus.ACTIVE, MeetingStatus.ENDED]))
        .order_by(
            live_first,
            func.coalesce(Meeting.scheduled_start, Meeting.created_at).desc(),
        )
        .limit(limit)
    )
    return list(db.scalars(stmt).unique().all())


@router.get(
    "/{meeting_id}",
    response_model=MeetingExistsResponse,
    summary="Check whether a meeting ID exists (public view, no passcode)",
)
def lookup_meeting(meeting_id: str, db: Session = Depends(get_db)) -> MeetingExistsResponse:
    """Pre-join validation for the lobby.

    Always answers 200. A malformed or unknown ID gives ``exists: false``;
    an ended meeting gives ``exists: true`` with ``status: "ended"`` so the UI
    can say so. The passcode is never returned, only ``passcode_required``.
    """
    normalized = normalize_meeting_id(meeting_id)
    meeting = db.get(Meeting, normalized) if normalized else None
    if meeting is None:
        return MeetingExistsResponse(exists=False, meeting=None)
    return MeetingExistsResponse(
        exists=True, meeting=MeetingPublicResponse.model_validate(meeting)
    )
