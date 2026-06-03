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
