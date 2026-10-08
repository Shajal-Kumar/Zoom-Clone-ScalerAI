"""Shared fixtures.

The database URL must be set BEFORE the application modules are imported,
because ``config.settings`` and the SQLAlchemy engine are created at import
time. Every test runs against a throwaway SQLite file.
"""

import os
import tempfile
from pathlib import Path

_TMP_DIR = tempfile.mkdtemp(prefix="zoom_clone_tests_")
os.environ["ZOOM_DATABASE_URL"] = f"sqlite:///{Path(_TMP_DIR) / 'test.db'}"
os.environ["ZOOM_SEED_ON_STARTUP"] = "false"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from database import Base, SessionLocal, engine  # noqa: E402
from main import app  # noqa: E402
from models import Meeting, MeetingStatus, User  # noqa: E402
from utils import utcnow  # noqa: E402


@pytest.fixture()
def client():
    """TestClient with a clean schema and the mock host user.

    Used as a context manager so the app lifespan runs and all WebSocket
    sessions share one event loop (required for cross-connection broadcasts).
    """
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        db.add(User(id="usr_default", name="Test Host", email="host@test.dev"))
        db.commit()
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def make_meeting(client):
    """Insert a meeting directly (bypassing the API) and return its ID."""

    def _make(
        meeting_id: str = "111-2222-3333",
        *,
        status: MeetingStatus = MeetingStatus.ACTIVE,
        title: str = "Test Meeting",
        scheduled_start=None,
        passcode: str | None = "ABC123",
        host_id: str = "usr_default",
    ) -> str:
        with SessionLocal() as db:
            db.add(
                Meeting(
                    id=meeting_id,
                    title=title,
                    host_id=host_id,
                    status=status,
                    scheduled_start=scheduled_start or utcnow(),
                    duration_minutes=30,
                    passcode=passcode,
                )
            )
            db.commit()
        return meeting_id

    return _make
