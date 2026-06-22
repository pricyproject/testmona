"""Runtime context for compiling TQL.

Holds the values that TQL functions resolve against — ``currentUser()`` and
``now()`` — so the compiler stays pure and easily testable (freeze ``now`` in a
test, inject any user id).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class EvalContext:
    current_user_id: Optional[int] = None
    now: datetime = field(default_factory=_utc_now)
    # Client timezone offset in minutes, using JS ``Date.getTimezoneOffset()``
    # semantics: ``UTC = local + tz_offset_minutes`` (e.g. UTC-7 → 420). A bare
    # date literal in a query (``created > 2026-06-09``) is the user's *local*
    # wall-clock day, so it is shifted by this offset before comparing against the
    # UTC timestamps stored in the DB — keeping the filter consistent with the
    # local-time dates the UI displays. Defaults to 0 (treat literals as UTC), so
    # API callers that don't pass an offset keep the previous behaviour.
    tz_offset_minutes: int = 0
