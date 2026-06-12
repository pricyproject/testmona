"""Shared tenacity-based retry/backoff policies.

Two independent concerns need bounded retry with backoff, and both were
previously best-effort or absent:

* **Outbound external-tracker calls** (Jira / GitHub / GitLab). Networks blip,
  trackers throttle (429 / 403-with-reset) and have transient 5xx. The Jira
  client had *no* retry at all; the GitHub/GitLab base client hand-rolled a
  linear retry loop. ``tracker_retry`` centralises this as exponential backoff
  with jitter that retries **only** transient failures — auth/validation errors
  still fail fast — and honours a server-provided cool-off when one is given.

* **Per-project ``project_seq`` allocation.** ``MAX(project_seq)+1`` can lose a
  race under concurrent inserts and collide on the unique
  ``(project_id, project_seq)`` index (IntegrityError), or deadlock on the
  ``SELECT ... FOR UPDATE`` project lock (OperationalError) on server backends.
  ``seq_conflict_retry`` re-runs the whole create — which re-reads the max and
  allocates a fresh number — a few times before giving up.
"""
from __future__ import annotations

import functools
from typing import Callable, Optional

from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session
from tenacity import (
    retry,
    retry_if_exception,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)


# --------------------------------------------------------------------------- #
# External issue trackers (Jira / GitHub / GitLab)
# --------------------------------------------------------------------------- #
class RetryableTrackerError(Exception):
    """A transient external-tracker failure that is worth retrying.

    ``retry_after`` (seconds), when set, is a server-provided cool-off (e.g. a
    rate-limit reset / ``Retry-After`` header) that is honoured in place of the
    default exponential backoff.
    """

    def __init__(self, message: str, retry_after: Optional[float] = None):
        super().__init__(message)
        self.retry_after = retry_after


def _tracker_wait(retry_state) -> float:
    """Honour a server cool-off if present, else exponential backoff + jitter."""
    exc = retry_state.outcome.exception() if retry_state.outcome else None
    if isinstance(exc, RetryableTrackerError) and exc.retry_after:
        return float(exc.retry_after)
    return wait_exponential_jitter(initial=1, max=30)(retry_state)


def tracker_retry(max_attempts: int = 3) -> Callable:
    """Decorator: retry transient external-tracker failures with backoff.

    Retries only :class:`RetryableTrackerError`; any other exception (auth,
    validation, programming errors) propagates immediately. After the final
    attempt the last error is re-raised unchanged.
    """
    return retry(
        retry=retry_if_exception_type(RetryableTrackerError),
        wait=_tracker_wait,
        stop=stop_after_attempt(max_attempts),
        reraise=True,
    )


# --------------------------------------------------------------------------- #
# project_seq allocation
# --------------------------------------------------------------------------- #
def _is_seq_conflict(exc: BaseException) -> bool:
    """True for a DB error caused by concurrent ``project_seq`` allocation.

    Matched defensively across backends: the unique index is named
    ``uq_<table>_project_seq`` and every backend's message (SQLite, MySQL/MariaDB,
    PostgreSQL) mentions ``project_seq``. Deadlocks / lock-wait timeouts from the
    ``FOR UPDATE`` project lock surface as OperationalError.
    """
    if isinstance(exc, IntegrityError):
        return "project_seq" in str(getattr(exc, "orig", None) or exc).lower()
    if isinstance(exc, OperationalError):
        text = str(getattr(exc, "orig", None) or exc).lower()
        return "deadlock" in text or "lock wait timeout" in text
    return False


def seq_conflict_retry(max_attempts: int = 5) -> Callable:
    """Decorator for ``f(db, ...)`` create paths: retry ``project_seq`` collisions.

    On a collision the SQLAlchemy session is left in a failed state, so the
    session is rolled back between attempts; the next run re-instantiates the
    row, the ``before_insert`` allocator re-reads ``MAX(project_seq)`` and the
    unique index is satisfied. The Session must be the first positional argument
    or passed as the ``db`` keyword.
    """

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def inner(*args, **kwargs):
            db = kwargs.get("db")
            if db is None and args:
                db = args[0]
            try:
                return func(*args, **kwargs)
            except Exception as exc:
                # Reset the broken session before tenacity re-invokes us, so the
                # retry starts from a clean transaction.
                if isinstance(db, Session) and _is_seq_conflict(exc):
                    db.rollback()
                raise

        return retry(
            retry=retry_if_exception(_is_seq_conflict),
            wait=wait_exponential_jitter(initial=0.05, max=2),
            stop=stop_after_attempt(max_attempts),
            reraise=True,
        )(inner)

    return decorator
