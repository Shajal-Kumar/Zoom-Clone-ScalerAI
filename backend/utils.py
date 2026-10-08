"""Small shared helpers: time, meeting IDs and passcodes."""

import re
import secrets
from datetime import datetime, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from sqlalchemy.orm import Session

# Unambiguous characters only (no 0/O, 1/I/L) so passcodes are easy to read out.
_PASSCODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
PASSCODE_LENGTH = 6


def utcnow() -> datetime:
    """Timezone-aware current time in UTC."""
    return datetime.now(timezone.utc)


def generate_meeting_id() -> str:
    """Return a Zoom-style meeting ID in the 3-4-4 format, e.g. ``849-2049-1029``.

    The leading group never starts with 0, so it always reads as three digits.
    """
    first = 100 + secrets.randbelow(900)
    second = secrets.randbelow(10_000)
    third = secrets.randbelow(10_000)
    return f"{first:03d}-{second:04d}-{third:04d}"


def normalize_meeting_id(raw: str | None) -> str | None:
    """Canonicalise user input to the 3-4-4 format, or return ``None`` if invalid.

    Accepts ``849-2049-1029``, ``849 2049 1029`` and ``84920491029``.
    """
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) != 11:
        return None
    return f"{digits[:3]}-{digits[3:7]}-{digits[7:]}"


def generate_unique_meeting_id(db: "Session", max_attempts: int = 10) -> str:
    """Generate a meeting ID that does not collide with an existing meeting."""
    from models import Meeting  # local import avoids a models <-> utils cycle

    for _ in range(max_attempts):
        candidate = generate_meeting_id()
        if db.get(Meeting, candidate) is None:
            return candidate
    raise RuntimeError("Could not generate a unique meeting ID; try again.")


def generate_passcode(length: int = PASSCODE_LENGTH) -> str:
    """Return a random, easy-to-read passcode."""
    return "".join(secrets.choice(_PASSCODE_ALPHABET) for _ in range(length))
