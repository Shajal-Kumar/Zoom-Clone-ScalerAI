"""Pydantic V2 schemas for request validation and response serialisation."""

from datetime import datetime, timezone

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
)

from config import settings
from models import MeetingStatus
from utils import utcnow

__all__ = [
    "MeetingStatus",
    "UserResponse",
    "InstantMeetingCreate",
    "MeetingScheduleCreate",
    "MeetingResponse",
    "MeetingEnvelope",
    "HostPublic",
    "MeetingPublicResponse",
    "MeetingExistsResponse",
    "ParticipantCreate",
    "MeetingParticipantResponse",
]


class ORMModel(BaseModel):
    """Base for response models built from ORM objects."""

    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------- #
# Users
# --------------------------------------------------------------------------- #
class UserResponse(ORMModel):
    id: str
    name: str
    email: EmailStr
    avatar_url: str | None = None
    created_at: datetime


# --------------------------------------------------------------------------- #
# Meetings: requests
# --------------------------------------------------------------------------- #
class InstantMeetingCreate(BaseModel):
    """POST /api/meetings/instant"""

    model_config = ConfigDict(str_strip_whitespace=True)

    host_id: str = Field(default=settings.default_user_id, min_length=1, max_length=36)
    title: str = Field(default="Instant Meeting", min_length=1, max_length=200)


class MeetingScheduleCreate(BaseModel):
    """POST /api/meetings/schedule

    ``scheduled_start`` should carry a UTC offset (e.g. ``toISOString()`` from
    the browser). A naive value is interpreted as UTC.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    scheduled_start: datetime
    duration_minutes: int = Field(default=30, ge=1, le=1440)
    passcode: str | None = Field(default=None, min_length=4, max_length=16, pattern=r"^[A-Za-z0-9]+$")
    host_id: str = Field(default=settings.default_user_id, min_length=1, max_length=36)

    @field_validator("scheduled_start")
    @classmethod
    def _must_be_in_future(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        value = value.astimezone(timezone.utc)
        if value <= utcnow():
            raise ValueError("scheduled_start must be in the future")
        return value


# --------------------------------------------------------------------------- #
# Meetings: responses
# --------------------------------------------------------------------------- #
class MeetingResponse(ORMModel):
    id: str
    title: str
    description: str | None = None
    host_id: str
    status: MeetingStatus
    scheduled_start: datetime | None = None
    duration_minutes: int
    passcode: str | None = None
    created_at: datetime
    host: UserResponse | None = None


class MeetingEnvelope(BaseModel):
    """``{ "meeting": MeetingObject }`` as specified for create endpoints."""

    meeting: MeetingResponse


class HostPublic(ORMModel):
    """Host details safe to show to anyone who knows a meeting ID (no email)."""

    id: str
    name: str
    avatar_url: str | None = None


class MeetingPublicResponse(ORMModel):
    """Meeting as seen through the public lookup: the passcode is never exposed,
    only whether one is required."""

    id: str
    title: str
    description: str | None = None
    host_id: str
    status: MeetingStatus
    scheduled_start: datetime | None = None
    duration_minutes: int
    created_at: datetime
    passcode_required: bool
    host: HostPublic | None = None


class MeetingExistsResponse(BaseModel):
    """``GET /api/meetings/{id}``"""

    exists: bool
    meeting: MeetingPublicResponse | None = None


# --------------------------------------------------------------------------- #
# Participants (used from Module 2 onwards)
# --------------------------------------------------------------------------- #
class ParticipantCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    user_display_name: str = Field(min_length=1, max_length=120)
    is_host: bool = False


class MeetingParticipantResponse(ORMModel):
    id: str
    meeting_id: str
    user_display_name: str
    is_host: bool
    joined_at: datetime
    left_at: datetime | None = None
