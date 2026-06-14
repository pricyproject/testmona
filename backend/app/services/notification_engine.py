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

Two product rules also live here so every feature inherits them for free:

* **No notifications for deactivated accounts.** Recipients are filtered to users
  who are not explicitly deactivated, so a disabled account never accrues unread
  rows it can never read.
* **Coalescing to fight notification fatigue.** Repetitive *informational*
  categories (a watched doc edited eight times in an hour, a run's status churning)
  set ``coalesce=True``. Instead of stacking eight unread bell items for the same
  entity, the engine folds a new event into the recipient's existing *unread*
  notification for that entity — updating its text and resurfacing it. Once the
  user has read it, the next event creates a fresh row, so genuinely new activity
  is never swallowed. Distinct actionable events (each mention, each assignment)
  keep ``coalesce=False`` because every one of them matters individually.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Notification, NotificationType, User

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class NotificationCategory:
    """Static description of one kind of notification.

    ``key`` is persisted on the notification row and shared with the frontend, so
    it must stay stable. ``actionable`` decides Work Inbox membership. ``coalesce``
    folds a repeat event into the recipient's existing unread notification for the
    same entity instead of inserting a new row (see module docstring); leave it
    off for categories where every event is individually meaningful.
    """

    key: str
    label: str
    type: NotificationType
    actionable: bool
    coalesce: bool = False


# --- Category registry ------------------------------------------------------
# Keys are persisted and sent to the client; treat them as a stable contract.

MENTION = NotificationCategory("mention", "Mentions", NotificationType.INFO, actionable=True)
COMMENT_REPLY = NotificationCategory("comment_reply", "Replies", NotificationType.INFO, actionable=True)
ASSIGNMENT = NotificationCategory("assignment", "Assignments", NotificationType.INFO, actionable=True)
REVIEW = NotificationCategory("review", "Reviews", NotificationType.WARNING, actionable=True)
FEEDBACK = NotificationCategory("feedback", "Feedback", NotificationType.WARNING, actionable=True)
# Informational: keep people in the loop, but nothing is expected of them. These
# fire repeatedly for the same entity, so they coalesce to avoid unread pile-up.
WATCH_CHANGE = NotificationCategory("watch_change", "Watched changes", NotificationType.INFO, actionable=False, coalesce=True)
STATUS = NotificationCategory("status", "Status updates", NotificationType.INFO, actionable=False, coalesce=True)
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

    The actor (``actor_id``) is never notified of their own action, duplicate
    recipient ids collapse to one notification, and deactivated accounts are
    dropped. For ``coalesce`` categories a repeat event for the same entity
    updates the recipient's existing unread notification instead of adding a new
    row (see module docstring). When ``commit`` is False the rows are added to the
    session but not committed, so the caller can persist them atomically with
    whatever change triggered them (the watch-on-version-save path relies on
    this). Any failure is logged and swallowed — a notification must never break
    the underlying action — so callers should not depend on the return value for
    correctness.
    """
    recipients = _active_recipients(db, _dedupe_recipients(user_ids, actor_id))
    if not recipients:
        return []

    notif_type = type_override or category.type
    title = (title or "")[:200]
    try:
        # Persist inside a SAVEPOINT so a failure here can never roll back the
        # caller's real work — notifications are strictly best-effort. Without
        # this, a transient insert error (or schema drift such as a missing
        # column) would poison the surrounding transaction and could undo the
        # action that triggered the notification (e.g. a test-run assignment).
        # On failure the nested block rolls back only to the savepoint, leaving
        # the outer transaction intact for the caller to commit.
        with db.begin_nested():
            rows = _persist(
                db,
                category=category,
                recipients=recipients,
                title=title,
                message=message,
                notif_type=notif_type,
                related_entity_type=related_entity_type,
                related_entity_id=related_entity_id,
                actor_id=actor_id,
            )
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


def _persist(
    db: Session,
    *,
    category: NotificationCategory,
    recipients: List[int],
    title: str,
    message: str,
    notif_type: NotificationType,
    related_entity_type: Optional[str],
    related_entity_id: Optional[int],
    actor_id: Optional[int],
) -> List[Notification]:
    """Insert one notification per recipient, coalescing where the category asks.

    Returns the resulting rows (a mix of freshly inserted and updated-in-place
    existing rows) so the caller can refresh them after commit.
    """
    existing_by_user = _coalescible_existing(
        db,
        category=category,
        recipients=recipients,
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
    )
    rows: List[Notification] = []
    for uid in recipients:
        existing = existing_by_user.get(uid)
        if existing is not None:
            # Fold the new event into the unread notification the recipient hasn't
            # seen yet: refresh its text/actor and resurface it to the top.
            existing.title = title
            existing.message = message
            existing.type = notif_type
            existing.actor_id = actor_id
            existing.created_at = func.now()
            rows.append(existing)
            continue
        row = Notification(
            user_id=uid,
            title=title,
            message=message,
            type=notif_type,
            category=category.key,
            actor_id=actor_id,
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
        )
        db.add(row)
        rows.append(row)
    return rows


def _coalescible_existing(
    db: Session,
    *,
    category: NotificationCategory,
    recipients: List[int],
    related_entity_type: Optional[str],
    related_entity_id: Optional[int],
) -> Dict[int, Notification]:
    """Map recipient id → their existing unread notification to coalesce into.

    Empty unless the category opts into coalescing and the event names a concrete
    entity (without an id there is nothing stable to coalesce on). Only unread,
    non-archived rows of the *same* category and entity qualify, so a read or
    dismissed notification never gets silently mutated. If a user somehow has
    several, the most recent (highest id) wins.
    """
    if not category.coalesce or related_entity_id is None:
        return {}
    existing = (
        db.query(Notification)
        .filter(
            Notification.user_id.in_(recipients),
            Notification.category == category.key,
            Notification.related_entity_type == related_entity_type,
            Notification.related_entity_id == related_entity_id,
            Notification.is_read == False,  # noqa: E712
            Notification.archived == False,  # noqa: E712
        )
        .all()
    )
    chosen: Dict[int, Notification] = {}
    for n in existing:
        current = chosen.get(n.user_id)
        if current is None or (n.id or 0) > (current.id or 0):
            chosen[n.user_id] = n
    return chosen


def _active_recipients(db: Session, recipients: List[int]) -> List[int]:
    """Drop explicitly deactivated accounts, preserving order.

    Only users known to be ``is_active == False`` are removed; users with no/NULL
    flag (legacy rows) are treated as active so we never silently swallow their
    notifications.
    """
    if not recipients:
        return []
    inactive = {
        uid
        for (uid,) in db.query(User.id)
        .filter(User.id.in_(recipients), User.is_active == False)  # noqa: E712
        .all()
    }
    return [uid for uid in recipients if uid not in inactive]


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
