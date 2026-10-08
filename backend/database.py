"""Database engine, session management and shared column types."""

from collections.abc import Generator
from datetime import datetime, timezone

from sqlalchemy import DateTime, create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.types import TypeDecorator

from config import settings

_is_sqlite = settings.database_url.startswith("sqlite")

engine: Engine = create_engine(
    settings.database_url,
    # FastAPI serves requests from a thread pool, so allow cross-thread use.
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    pool_pre_ping=True,
)


if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _configure_sqlite(dbapi_connection, _connection_record) -> None:
        """Per-connection pragmas.

        - foreign_keys: SQLite ignores FK constraints (and ON DELETE CASCADE)
          unless this is enabled on every connection.
        - journal_mode=WAL: lets readers and a writer proceed concurrently,
          which matters once WebSocket handlers start writing.
        """
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()


SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    expire_on_commit=False,
    class_=Session,
)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


class UTCDateTime(TypeDecorator):
    """DateTime that is always stored as UTC and returned timezone-aware.

    SQLite has no native timezone support and silently drops tzinfo. This type
    normalises aware values to UTC on the way in (naive values are assumed to
    already be UTC) and re-attaches UTC on the way out, so API responses are
    serialised with a ``Z`` suffix and never shift between machines.
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc)
        return value.replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: one session per request, always closed."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create all tables. Safe to call repeatedly."""
    import models  # noqa: F401  (registers models on Base.metadata)

    Base.metadata.create_all(bind=engine)
