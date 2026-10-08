"""Passcode comparison and a failure limiter shared by REST and WebSocket joins."""

import hmac
import time
from collections import deque

from config import settings

LimiterKey = tuple[str, str]  # (client ip, normalised meeting id)


def passcodes_match(supplied: str | None, expected: str | None) -> bool:
    """Case-insensitive, whitespace-trimmed, constant-time comparison."""
    a = (supplied or "").strip().upper().encode("utf-8")
    b = (expected or "").strip().upper().encode("utf-8")
    return hmac.compare_digest(a, b)


class FailureLimiter:
    """Sliding window of failed attempts per key (in memory, single process)."""

    def __init__(self) -> None:
        self._hits: dict[LimiterKey, deque[float]] = {}

    def _window(self, key: LimiterKey, now: float) -> deque[float] | None:
        hits = self._hits.get(key)
        if hits is None:
            return None
        while hits and now - hits[0] > settings.passcode_attempt_window_seconds:
            hits.popleft()
        if not hits:
            del self._hits[key]
            return None
        return hits

    def retry_after(self, key: LimiterKey) -> int:
        """Seconds until ``key`` may try again; 0 when it is not blocked."""
        now = time.monotonic()
        hits = self._window(key, now)
        if hits is None or len(hits) < settings.passcode_attempt_limit:
            return 0
        return max(1, int(settings.passcode_attempt_window_seconds - (now - hits[0])) + 1)

    def record_failure(self, key: LimiterKey) -> None:
        self._hits.setdefault(key, deque()).append(time.monotonic())

    def clear(self) -> None:
        self._hits.clear()


passcode_limiter = FailureLimiter()
