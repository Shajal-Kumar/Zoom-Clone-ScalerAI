"""Idempotent demo-data seeding.

Run standalone::

    python seed.py

or call :func:`seed_database` from application startup. Every record uses a
fixed primary key and is only inserted when missing, so repeated runs never
create duplicates. Dates are computed relative to *now*, so "upcoming" meetings
stay in the future and "recent" ones stay in the past on a fresh database.
"""

import logging
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from config import settings
from database import SessionLocal, init_db
from models import Meeting, MeetingParticipant, MeetingStatus, User
from utils import utcnow

logger = logging.getLogger(__name__)

DEFAULT_USER = {
    "id": settings.default_user_id,
    "name": "Shajal Kumar Chaudhary",
    "email": "shajal@zoom.clone",
    "avatar_url": None,
}


def _next_half_hour(moment: datetime) -> datetime:
    """Round ``moment`` up to the next :00 or :30 mark."""
    moment = moment.replace(second=0, microsecond=0)
    minutes_to_add = 30 - (moment.minute % 30)
    return moment + timedelta(minutes=minutes_to_add)


def _meeting_specs(now: datetime) -> list[dict]:
    base = _next_half_hour(now)
    return [
        # ---- Upcoming ---------------------------------------------------- #
        {
            "id": "849-2049-1029",
            "title": "Engineering Sync",
            "description": "Weekly sync on sprint progress, blockers and deployments.",
            "status": MeetingStatus.SCHEDULED,
            "scheduled_start": base + timedelta(hours=3),
            "duration_minutes": 45,
            "passcode": "ENG482",
            "participants": [],
        },
        {
            "id": "512-3380-7741",
            "title": "Product Review",
            "description": "Review the roadmap and the latest feature demos with stakeholders.",
            "status": MeetingStatus.SCHEDULED,
            "scheduled_start": base + timedelta(days=1, hours=1),
            "duration_minutes": 60,
            "passcode": "PRD739",
            "participants": [],
        },
        {
            "id": "307-9921-4056",
            "title": "1-on-1 Mentorship",
            "description": "Career growth, code review feedback and goal setting.",
            "status": MeetingStatus.SCHEDULED,
            "scheduled_start": base + timedelta(days=2),
            "duration_minutes": 30,
            "passcode": "MNT265",
            "participants": [],
        },
        # ---- Recent ------------------------------------------------------ #
        {
            "id": "645-1872-3390",
            "title": "Sprint Retrospective",
            "description": "What went well, what did not, and actions for next sprint.",
            "status": MeetingStatus.ENDED,
            "scheduled_start": now - timedelta(days=1, hours=2),
            "duration_minutes": 45,
            "passcode": "RET914",
            "participants": [
                # (display name, is_host, joined offset from start, left offset from start)
                (DEFAULT_USER["name"], True, timedelta(minutes=0), timedelta(minutes=44)),
                ("Aarav Mehta", False, timedelta(minutes=2), timedelta(minutes=43)),
                ("Priya Nair", False, timedelta(minutes=4), timedelta(minutes=41)),
            ],
        },
        {
            # Still running: exercises the live "Join" state on the dashboard.
            "id": "228-6403-9185",
            "title": "Design Critique",
            "description": "Open design review of the new meeting-room layout.",
            "status": MeetingStatus.ACTIVE,
            "scheduled_start": now - timedelta(minutes=25),
            "duration_minutes": 60,
            "passcode": "DSG357",
            "participants": [
                (DEFAULT_USER["name"], True, timedelta(minutes=0), None),
                ("Rohan Gupta", False, timedelta(minutes=3), None),
            ],
        },
    ]


def seed_database(db: Session) -> dict[str, int]:
    """Insert any missing demo records. Returns counts of newly created rows."""
    created = {"users": 0, "meetings": 0, "participants": 0}
    now = utcnow()

    if db.get(User, DEFAULT_USER["id"]) is None:
        db.add(User(**DEFAULT_USER))
        created["users"] += 1

    for spec in _meeting_specs(now):
        if db.get(Meeting, spec["id"]) is not None:
            continue

        start = spec["scheduled_start"]
        meeting = Meeting(
            id=spec["id"],
            title=spec["title"],
            description=spec["description"],
            host_id=DEFAULT_USER["id"],
            status=spec["status"],
            scheduled_start=start,
            duration_minutes=spec["duration_minutes"],
            passcode=spec["passcode"],
        )
        for name, is_host, joined_offset, left_offset in spec["participants"]:
            meeting.participants.append(
                MeetingParticipant(
                    user_display_name=name,
                    is_host=is_host,
                    joined_at=start + joined_offset,
                    left_at=(start + left_offset) if left_offset is not None else None,
                )
            )
            created["participants"] += 1

        db.add(meeting)
        created["meetings"] += 1

    db.commit()
    return created


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
    init_db()
    with SessionLocal() as db:
        created = seed_database(db)
    if any(created.values()):
        logger.info(
            "Seeded %d user(s), %d meeting(s), %d participant(s).",
            created["users"],
            created["meetings"],
            created["participants"],
        )
    else:
        logger.info("Database already seeded; nothing to do.")


if __name__ == "__main__":
    main()
