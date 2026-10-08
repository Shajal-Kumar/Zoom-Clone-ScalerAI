"""SQLAlchemy ORM models."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base, UTCDateTime
from utils import utcnow


def _uuid_str() -> str:
    return str(uuid.uuid4())


class MeetingStatus(str, enum.Enum):
    SCHEDULED = "scheduled"
    ACTIVE = "active"
    ENDED = "ended"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    meetings: Mapped[list["Meeting"]] = relationship(
        back_populates="host",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    def __repr__(self) -> str:
        return f"<User id={self.id!r} email={self.email!r}>"


class Meeting(Base):
    __tablename__ = "meetings"
    __table_args__ = (
        CheckConstraint(
            "duration_minutes BETWEEN 1 AND 1440", name="ck_meetings_duration_range"
        ),
    )

    # Formatted ID, e.g. "849-2049-1029".
    id: Mapped[str] = mapped_column(String(13), primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    host_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[MeetingStatus] = mapped_column(
        SAEnum(
            MeetingStatus,
            name="meeting_status",
            native_enum=False,
            create_constraint=True,  # emits a CHECK constraint on SQLite
            length=20,
            validate_strings=True,
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        default=MeetingStatus.SCHEDULED,
        server_default=MeetingStatus.SCHEDULED.value,
        nullable=False,
        index=True,
    )
    scheduled_start: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True, index=True
    )
    duration_minutes: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    passcode: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    # Eager-loaded: responses always include the host, and this avoids lazy
    # loads after the request session has closed.
    host: Mapped["User"] = relationship(back_populates="meetings", lazy="joined")
    participants: Mapped[list["MeetingParticipant"]] = relationship(
        back_populates="meeting",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="MeetingParticipant.joined_at",
    )

    @property
    def passcode_required(self) -> bool:
        """Public lookups expose this flag instead of the passcode itself."""
        return bool(self.passcode)

    def __repr__(self) -> str:
        return f"<Meeting id={self.id!r} title={self.title!r} status={self.status.value!r}>"


class MeetingParticipant(Base):
    __tablename__ = "meeting_participants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    meeting_id: Mapped[str] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_host: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    joined_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    left_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    meeting: Mapped["Meeting"] = relationship(back_populates="participants")

    def __repr__(self) -> str:
        return (
            f"<MeetingParticipant id={self.id!r} meeting_id={self.meeting_id!r} "
            f"name={self.user_display_name!r}>"
        )
