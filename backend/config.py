"""Application configuration.

Values can be overridden with environment variables prefixed ``ZOOM_`` or via a
``.env`` file, e.g.::

    ZOOM_DATABASE_URL=sqlite:///./zoom_clone.db
    ZOOM_CORS_ORIGINS=["http://localhost:3000"]
    ZOOM_SEED_ON_STARTUP=false
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    app_name: str = "Zoom API"
    app_version: str = "0.1.0"

    # Absolute path so the DB location does not depend on the working directory.
    database_url: str = f"sqlite:///{BASE_DIR / 'zoom_clone.db'}"

    # JSON list when set through the environment.
    cors_origins: list[str] = ["http://localhost:3000"]

    # The mock session user (see SRS: "host_id": "usr_default").
    default_user_id: str = "usr_default"

    # Populate demo data on startup when it is missing (idempotent).
    seed_on_startup: bool = True

    # ---- Meeting lifecycle ------------------------------------------------ #
    # How long an `active` meeting stays joinable after its last participant
    # leaves. Any (re)join inside the window cancels the timer; only after it
    # lapses is the meeting marked `ended`. A host `end_meeting` ends it at once.
    empty_room_grace_seconds: float = 300.0

    # Scheduled meetings never expire on their own. They are simply kept in
    # /upcoming for this many hours after their start so a late host still
    # sees them on the dashboard.
    upcoming_grace_hours: int = 24

    # ---- WebRTC signalling (WebSocket) ------------------------------------ #
    # Mesh topology degrades quickly past a handful of peers.
    max_room_participants: int = 6
    ws_max_message_bytes: int = 64 * 1024
    # Close sockets that send nothing (not even a `ping`) for this long.
    ws_idle_timeout_seconds: float = 90.0
    chat_max_length: int = 2000
    chat_history_size: int = 100
    chat_rate_limit_count: int = 10
    chat_rate_limit_window_seconds: float = 5.0
    reaction_rate_limit_count: int = 5
    reaction_rate_limit_window_seconds: float = 3.0

    # ---- Passcode brute-force guard (REST verify + WebSocket join) -------- #
    passcode_attempt_limit: int = 5
    passcode_attempt_window_seconds: float = 60.0

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="ZOOM_",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
