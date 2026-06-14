"""Watch / change-notification service for docs and requirements.

A user can *watch* a doc or a requirement. When a watched entity records a new
content version, every watcher except the person who made the change receives a
:class:`~app.models.Notification` summarising *what* changed and *who* changed it.
The notification deep-links to the entity's version history, where the per-field
diff shows the reader exactly which parts changed and when.

Watch state lives in the generic :class:`~app.models.EntityWatch` table; this
module centralises the small amount of logic the routes and the version-recording
CRUD share so neither has to know the table shape.
"""

from __future__ import annotations

import logging
from typing import List, Optional, Sequence

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import EntityWatch, User
from . import notification_engine

logger = logging.getLogger(__name__)

# The two kinds of entity a user may watch.
DOC = "doc"
REQUIREMENT = "requirement"
_VALID_ENTITY_TYPES = {DOC, REQUIREMENT}

# Notification ``related_entity_type`` values. Distinct from the plain
# ``"doc"``/``"requirement"`` used by comment/mention notifications so the
# frontend can route a watch alert straight to the version-history diff.
_CHANGE_NOTIFICATION_TYPE = {DOC: "doc_change", REQUIREMENT: "requirement_change"}

_ACTION_VERB = {
    "updated": "updated",
    "restored": "restored",
    "published": "published",
}


def _normalise_entity_type(entity_type: str) -> str:
    if entity_type not in _VALID_ENTITY_TYPES:
        raise ValueError(f"Unsupported watch entity type: {entity_type!r}")
    return entity_type


def is_watching(db: Session, user_id: int, entity_type: str, entity_id: int) -> bool:
    _normalise_entity_type(entity_type)
    return (
        db.query(EntityWatch.id)
        .filter(
            EntityWatch.user_id == user_id,
            EntityWatch.entity_type == entity_type,
            EntityWatch.entity_id == entity_id,
        )
        .first()
        is not None
    )


def count_watchers(db: Session, entity_type: str, entity_id: int) -> int:
    _normalise_entity_type(entity_type)
    return (
        db.query(EntityWatch.id)
        .filter(EntityWatch.entity_type == entity_type, EntityWatch.entity_id == entity_id)
        .count()
    )


def watcher_ids(
    db: Session,
    entity_type: str,
    entity_id: int,
    exclude_user_id: Optional[int] = None,
) -> List[int]:
    _normalise_entity_type(entity_type)
    rows = (
        db.query(EntityWatch.user_id)
        .filter(EntityWatch.entity_type == entity_type, EntityWatch.entity_id == entity_id)
        .all()
    )
    return [uid for (uid,) in rows if uid != exclude_user_id]


def add_watch(db: Session, user_id: int, entity_type: str, entity_id: int) -> EntityWatch:
    """Start watching (idempotent). Returns the existing or newly created row."""
    _normalise_entity_type(entity_type)
    existing = (
        db.query(EntityWatch)
        .filter(
            EntityWatch.user_id == user_id,
            EntityWatch.entity_type == entity_type,
            EntityWatch.entity_id == entity_id,
        )
        .first()
    )
    if existing is not None:
        return existing
    watch = EntityWatch(user_id=user_id, entity_type=entity_type, entity_id=entity_id)
    db.add(watch)
    try:
        db.commit()
    except IntegrityError:
        # Two concurrent watch requests raced on the unique constraint; the row
        # already exists, so treat this as success.
        db.rollback()
        return (
            db.query(EntityWatch)
            .filter(
                EntityWatch.user_id == user_id,
                EntityWatch.entity_type == entity_type,
                EntityWatch.entity_id == entity_id,
            )
            .first()
        )
    db.refresh(watch)
    return watch


def remove_watch(db: Session, user_id: int, entity_type: str, entity_id: int) -> bool:
    """Stop watching. Returns True if a watch existed and was removed."""
    _normalise_entity_type(entity_type)
    deleted = (
        db.query(EntityWatch)
        .filter(
            EntityWatch.user_id == user_id,
            EntityWatch.entity_type == entity_type,
            EntityWatch.entity_id == entity_id,
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    return bool(deleted)


def clear_watches(db: Session, entity_type: str, entity_id: int) -> int:
    """Remove every watch for an entity (call when it is deleted, since
    ``entity_id`` is a loose reference with no database foreign key). Does not
    commit — the caller's delete commit covers it."""
    _normalise_entity_type(entity_type)
    return (
        db.query(EntityWatch)
        .filter(EntityWatch.entity_type == entity_type, EntityWatch.entity_id == entity_id)
        .delete(synchronize_session=False)
    )


def list_user_watches(db: Session, user_id: int) -> List[EntityWatch]:
    return (
        db.query(EntityWatch)
        .filter(EntityWatch.user_id == user_id)
        .order_by(EntityWatch.created_at.desc())
        .all()
    )


def notify_watchers_of_change(
    db: Session,
    *,
    entity_type: str,
    entity_id: int,
    label: str,
    version_number: int,
    action: str,
    actor_id: Optional[int],
    changed_fields: Sequence[str] | None = None,
    change_note: Optional[str] = None,
    batch: "notification_engine.NotificationBatch | None" = None,
) -> None:
    """Queue change notifications for every watcher except the actor.

    When a ``batch`` is supplied the watch intent is *added* to it and nothing is
    emitted here — the owning write path flushes the batch once so this broadcast
    is de-duplicated against any higher-priority notification (assignment, mention)
    for the same recipient and entity. When no batch is supplied the intent is
    emitted on its own with ``commit=False``, so the rows are added to the session
    but not committed and persist atomically with the version row by the caller's
    commit (the doc create/restore/merge paths rely on this). Either way this is
    best-effort: any failure is logged and swallowed so it can never break the
    underlying save.
    """
    try:
        _normalise_entity_type(entity_type)
        recipients = watcher_ids(db, entity_type, entity_id, exclude_user_id=actor_id)
        if not recipients:
            return

        actor = (
            db.query(User).filter(User.id == actor_id).first() if actor_id is not None else None
        )
        actor_name = (actor.full_name or actor.username) if actor is not None else "Someone"
        verb = _ACTION_VERB.get(action, "changed")

        fields = [f for f in (changed_fields or []) if f]
        changed_clause = f" Changed: {', '.join(fields)}." if fields else ""
        note_clause = f' Note: "{change_note.strip()}".' if change_note and change_note.strip() else ""

        title = f"{label} was {verb}"
        message = (
            f"{actor_name} {verb} {label} (v{version_number})."
            f"{changed_clause}{note_clause}"
            " Open the version history to see exactly what changed."
        )
        related_type = _CHANGE_NOTIFICATION_TYPE[entity_type]

        target = batch or notification_engine.NotificationBatch()
        target.add(
            category=notification_engine.WATCH_CHANGE,
            user_ids=recipients,
            actor_id=actor_id,
            title=title,
            message=message,
            related_entity_type=related_type,
            related_entity_id=entity_id,
        )
        # Standalone (no caller batch): emit now with commit=False so the rows are
        # flushed with the caller's version-save commit and persist atomically.
        # With a caller batch, the owning write path flushes it once after adding
        # its own (higher-priority) intents.
        if batch is None:
            target.flush(db, commit=False)
    except Exception:
        logger.exception(
            "Failed to queue watch notifications for %s %s", entity_type, entity_id
        )
