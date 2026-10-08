"""Meeting REST endpoints (all under ``/api/meetings``).

Route order matters: the fixed paths ``/upcoming`` and ``/recent`` are declared
before ``/{meeting_id}`` so the path parameter cannot swallow them.
"""

from collections.abc import Callable
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
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
    MeetingUpdate,
    VerifyPasscodeRequest,
    VerifyPasscodeResponse,
)
from passcode import passcode_limiter, passcodes_match
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


@router.patch(
    "/{meeting_id}",
    response_model=MeetingEnvelope,
    summary="Edit a meeting's title, passcode or start time",
)
def update_meeting(
    meeting_id: str,
    body: MeetingUpdate,
    db: Session = Depends(get_db),
) -> MeetingEnvelope:
    """Partial update: only the fields present in the body are changed.

    Ended meetings are read-only (409). Returns the full meeting, same shape as
    the create endpoints, so the client can swap it into its cache.
    """
    normalized = normalize_meeting_id(meeting_id)
    meeting = db.get(Meeting, normalized) if normalized else None
    if meeting is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Meeting not found"
        )
    if meeting.status == MeetingStatus.ENDED:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="Ended meetings can't be edited",
        )

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(meeting, field, value)
    db.commit()
    db.refresh(meeting)
    return MeetingEnvelope(meeting=MeetingResponse.model_validate(meeting))


@router.post(
    "/{meeting_id}/verify-passcode",
    response_model=VerifyPasscodeResponse,
    summary="Check a passcode before joining (rate limited per IP + meeting)",
)
def verify_passcode(
    meeting_id: str,
    body: VerifyPasscodeRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> VerifyPasscodeResponse:
    """Always 200 with ``{valid, reason}``; 429 once the failure limit is hit.

    Comparison is case-insensitive and constant-time. A meeting without a
    passcode is always valid. Failures are shared with WebSocket joins.
    """
    normalized = normalize_meeting_id(meeting_id)
    key = (request.client.host if request.client else "unknown", normalized or "invalid")
    wait = passcode_limiter.retry_after(key)
    if wait:
        raise HTTPException(
            status_code=http_status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many incorrect passcodes. Try again shortly.",
            headers={"Retry-After": str(wait)},
        )

    meeting = db.get(Meeting, normalized) if normalized else None
    if meeting is None:
        return VerifyPasscodeResponse(valid=False, reason="not_found")
    if meeting.status == MeetingStatus.ENDED:
        return VerifyPasscodeResponse(valid=False, reason="ended")
    if not meeting.passcode or passcodes_match(body.passcode, meeting.passcode):
        return VerifyPasscodeResponse(valid=True)

    passcode_limiter.record_failure(key)
    return VerifyPasscodeResponse(valid=False, reason="incorrect")
