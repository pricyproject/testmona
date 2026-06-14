"""Central notification engine.

Before this module, every feature minted :class:`~app.models.Notification` rows by
hand — duplicating the ``crud.create_notification`` boilerplate, the actor-exclusion
rule, and the "best effort, never break the caller" try/except. There was also no
machine-readable sense of *what kind* of notification a row was, so nothing could
tell an actionable "you were assigned a defect" apart from an informational "a doc
you watch changed".

The engine fixes both. Every notification now flows through :func:`emit`, which:

* stamps a :class:`NotificationCategory` so the row is self-describing;
* derives the visual ``type`` (info/success/warning/error) from the category;
* excludes the actor and de-duplicates recipients;
* swallows and logs failures so a notification can never break the action that
  triggered it.

The category registry is also the single source of truth for the **Work Inbox**:
each category declares whether it is *actionable* (something the recipient is
expected to do — a mention, an assignment, a review request, feedback) or merely
*informational* (a watched entity changed, a run you own completed). The inbox
surfaces the actionable ones; the bell dropdown shows everything.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Iterable, List, Optional

from sqlalchemy.orm import Session

from ..models import Notification, NotificationType, User

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class NotificationCategory:
    """Static description of one kind of notification.

    ``key`` is persisted on the notification row and shared with the frontend, so
    it must stay stable. ``actionable`` decides Work Inbox membership.
    """

    key: str
    label: str
    type: NotificationType
    actionable: bool


# --- Category registry ------------------------------------------------------
# Keys are persisted and sent to the client; treat them as a stable contract.

MENTION = NotificationCategory("mention", "Mentions", NotificationType.INFO, actionable=True)
COMMENT_REPLY = NotificationCategory("comment_reply", "Replies", NotificationType.INFO, actionable=True)
ASSIGNMENT = NotificationCategory("assignment", "Assignments", NotificationType.INFO, actionable=True)
REVIEW = NotificationCategory("review", "Reviews", NotificationType.WARNING, actionable=True)
FEEDBACK = NotificationCategory("feedback", "Feedback", NotificationType.WARNING, actionable=True)
# Informational: keep people in the loop, but nothing is expected of them.
WATCH_CHANGE = NotificationCategory("watch_change", "Watched changes", NotificationType.INFO, actionable=False)
STATUS = NotificationCategory("status", "Status updates", NotificationType.INFO, actionable=False)
SYSTEM = NotificationCategory("system", "System", NotificationType.INFO, actionable=False)

_CATEGORIES = {
    c.key: c
    for c in (
        MENTION,
        COMMENT_REPLY,
        ASSIGNMENT,
        REVIEW,
        FEEDBACK,
        WATCH_CHANGE,
        STATUS,
        SYSTEM,
    )
}


def get_category(key: str) -> Optional[NotificationCategory]:
    return _CATEGORIES.get(key)


def all_categories() -> List[NotificationCategory]:
    return list(_CATEGORIES.values())


def actionable_category_keys() -> List[str]:
    """Keys of every category that belongs in the Work Inbox."""
    return [c.key for c in _CATEGORIES.values() if c.actionable]


def emit(
    db: Session,
    *,
    category: NotificationCategory,
    user_ids: Iterable[int],
    title: str,
    message: str,
    related_entity_type: Optional[str] = None,
    related_entity_id: Optional[int] = None,
    actor_id: Optional[int] = None,
    type_override: Optional[NotificationType] = None,
    commit: bool = True,
) -> List[Notification]:
    """Create one notification per recipient and return the rows.

    The actor (``actor_id``) is never notified of their own action, and duplicate
    recipient ids collapse to one notification. When ``commit`` is False the rows
    are added to the session but not committed, so the caller can persist them
    atomically with whatever change triggered them (the watch-on-version-save path
    relies on this). Any failure is logged and swallowed — a notification must
    never break the underlying action — so callers should not depend on the
    return value for correctness.
    """
    recipients = _dedupe_recipients(user_ids, actor_id)
    if not recipients:
        return []

    notif_type = type_override or category.type
    title = (title or "")[:200]
    rows = [
        Notification(
            user_id=uid,
            title=title,
            message=message,
            type=notif_type,
            category=category.key,
            actor_id=actor_id,
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
        )
        for uid in recipients
    ]
    try:
        # Insert inside a SAVEPOINT so a failure here can never roll back the
        # caller's real work — notifications are strictly best-effort. Without
        # this, a transient insert error (or schema drift such as a missing
        # column) would poison the surrounding transaction and could undo the
        # action that triggered the notification (e.g. a test-run assignment).
        # On failure the nested block rolls back only to the savepoint, leaving
        # the outer transaction intact for the caller to commit.
        with db.begin_nested():
            db.add_all(rows)
            db.flush()
        if commit:
            db.commit()
            for row in rows:
                db.refresh(row)
        return rows
    except Exception:
        logger.exception(
            "Failed to emit %s notifications (entity=%s/%s)",
            category.key,
            related_entity_type,
            related_entity_id,
        )
        return []


def actor_display_name(actor: Optional[User]) -> str:
    """Human label for the person who triggered a notification."""
    if actor is None:
        return "Someone"
    return actor.full_name or actor.username or getattr(actor, "email", None) or "Someone"


def _dedupe_recipients(user_ids: Iterable[int], actor_id: Optional[int]) -> List[int]:
    seen: set[int] = set()
    ordered: List[int] = []
    for uid in user_ids:
        if uid is None or uid == actor_id or uid in seen:
            continue
        seen.add(uid)
        ordered.append(uid)
    return ordered
