"""Work Inbox routes.

The Work Inbox is the actionable slice of a user's notifications — mentions,
assignments, review requests, and feedback — presented as a personal task queue
they can triage (mark read) and clear (archive/done). Membership is decided by the
notification engine's category registry, not hard-coded here, so adding a new
actionable category automatically surfaces it in the inbox.
"""

import logging
from typing import Optional

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..database import get_db
from ..auth import get_current_active_user
from ..services import notification_engine

logger = logging.getLogger(__name__)


def register_inbox_routes(app):
    """Register Work Inbox routes with the FastAPI app."""

    def _actionable_keys():
        return notification_engine.actionable_category_keys()

    @app.get("/inbox", response_model=list[schemas.Notification])
    def list_inbox(
        status: str = Query("open", pattern="^(open|snoozed|done|all)$"),
        category: Optional[str] = None,
        unread_only: bool = False,
        search: Optional[str] = Query(None, min_length=1, max_length=200),
        actor_id: Optional[int] = Query(None, ge=1),
        project_id: Optional[int] = Query(None, ge=1),
        sort: str = Query("newest", pattern="^(newest|oldest)$"),
        skip: int = Query(0, ge=0),
        limit: int = Query(50, ge=1, le=100),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _validate_category(category)
        # Lazy global sweep: return any due-snooze items to open before reading.
        crud.sweep_due_snoozes(db)
        items = crud.get_inbox_notifications(
            db,
            user_id=current_user.id,
            actionable_categories=_actionable_keys(),
            status=status,
            category=category,
            unread_only=unread_only,
            search=search,
            actor_id=actor_id,
            project_id=project_id,
            sort=sort,
            skip=skip,
            limit=limit,
        )
        crud.resolve_actor_names(db, items)
        crud.resolve_inbox_projects(db, items)
        return items

    @app.get("/inbox/actors", response_model=list[schemas.InboxActorOption])
    def inbox_actors(
        status: str = Query("open", pattern="^(open|snoozed|done|all)$"),
        category: Optional[str] = None,
        unread_only: bool = False,
        search: Optional[str] = Query(None, min_length=1, max_length=200),
        project_id: Optional[int] = Query(None, ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _validate_category(category)
        crud.sweep_due_snoozes(db)
        rows = crud.get_inbox_actor_options(
            db,
            user_id=current_user.id,
            actionable_categories=_actionable_keys(),
            status=status,
            category=category,
            unread_only=unread_only,
            search=search,
            project_id=project_id,
        )
        return [schemas.InboxActorOption(id=uid, name=name) for uid, name in rows]

    @app.get("/inbox/projects", response_model=list[schemas.InboxProjectOption])
    def inbox_projects(
        status: str = Query("open", pattern="^(open|snoozed|done|all)$"),
        category: Optional[str] = None,
        unread_only: bool = False,
        search: Optional[str] = Query(None, min_length=1, max_length=200),
        actor_id: Optional[int] = Query(None, ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _validate_category(category)
        crud.sweep_due_snoozes(db)
        rows = crud.get_inbox_project_options(
            db,
            user_id=current_user.id,
            actionable_categories=_actionable_keys(),
            status=status,
            category=category,
            unread_only=unread_only,
            search=search,
            actor_id=actor_id,
        )
        return [schemas.InboxProjectOption(id=pid, name=name) for pid, name in rows]

    @app.get("/inbox/summary", response_model=schemas.InboxSummary)
    def inbox_summary(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        # Keep counts honest by resurfacing due-snooze items first.
        crud.sweep_due_snoozes(db)
        actionable = notification_engine.all_categories()
        actionable_keys = [c.key for c in actionable if c.actionable]
        total_open, total_unread, total_snoozed, per_category = crud.get_inbox_summary(
            db, user_id=current_user.id, actionable_categories=actionable_keys
        )
        categories = [
            schemas.InboxCategorySummary(
                key=c.key,
                label=c.label,
                open=per_category.get(c.key, {}).get("open", 0),
                snoozed=per_category.get(c.key, {}).get("snoozed", 0),
                done=per_category.get(c.key, {}).get("done", 0),
                unread=per_category.get(c.key, {}).get("unread", 0),
            )
            for c in actionable
            if c.actionable
        ]
        return schemas.InboxSummary(
            total_open=total_open,
            total_unread=total_unread,
            total_snoozed=total_snoozed,
            categories=categories,
        )

    def _validate_category(category: Optional[str]):
        if category is not None and category not in _actionable_keys():
            raise HTTPException(status_code=400, detail="Unknown inbox category")

    @app.post("/inbox/archive-all")
    def archive_all_inbox(
        category: Optional[str] = None,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _validate_category(category)
        count = crud.archive_inbox_notifications(
            db, user_id=current_user.id, actionable_categories=_actionable_keys(), category=category
        )
        _record_inbox_observability(
            db,
            current_user,
            action="archive_all",
            affected_count=count,
            metadata={"category": category},
        )
        _record_inbox_zero_if_reached(db, current_user)
        return {"message": f"Archived {count} items", "archived_count": count}

    @app.post("/inbox/mark-all-read")
    def mark_inbox_read(
        category: Optional[str] = None,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _validate_category(category)
        count = crud.mark_inbox_all_read(
            db, user_id=current_user.id, actionable_categories=_actionable_keys(), category=category
        )
        _record_inbox_observability(
            db,
            current_user,
            action="mark_all_read",
            affected_count=count,
            metadata={"category": category},
        )
        return {"message": f"Marked {count} items read", "marked_count": count}

    @app.post("/inbox/unsnooze-all")
    def unsnooze_all_inbox(
        category: Optional[str] = None,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _validate_category(category)
        count = crud.unsnooze_inbox_notifications(
            db, user_id=current_user.id, actionable_categories=_actionable_keys(), category=category
        )
        _record_inbox_observability(
            db,
            current_user,
            action="unsnooze_all",
            affected_count=count,
            metadata={"category": category},
        )
        return {"message": f"Unsnoozed {count} items", "unsnoozed_count": count}

    @app.delete("/inbox/cleanup-done")
    def cleanup_done_inbox(
        days_old: int = Query(90, ge=1, le=3650),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        count = crud.delete_old_done_inbox_notifications(
            db,
            user_id=current_user.id,
            actionable_categories=_actionable_keys(),
            days_old=days_old,
        )
        return {"message": f"Deleted {count} old done inbox items", "deleted_count": count}

    @app.post("/inbox/{notification_id}/archive", response_model=schemas.Notification)
    def archive_inbox_item(
        notification_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        notification = _set_archived(db, notification_id, current_user, archived=True)
        _record_inbox_observability(
            db,
            current_user,
            action="archive",
            affected_count=1,
            notification_id=notification_id,
        )
        _record_inbox_zero_if_reached(db, current_user)
        return notification

    @app.post("/inbox/{notification_id}/unarchive", response_model=schemas.Notification)
    def unarchive_inbox_item(
        notification_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        notification = _set_archived(db, notification_id, current_user, archived=False)
        _record_inbox_observability(
            db,
            current_user,
            action="unarchive",
            affected_count=1,
            notification_id=notification_id,
        )
        return notification

    def _set_archived(db: Session, notification_id: int, current_user, archived: bool):
        _owned_notification(db, notification_id, current_user)
        return crud.set_notification_archived(db, notification_id=notification_id, archived=archived)

    def _owned_notification(db: Session, notification_id: int, current_user):
        """Fetch a notification the caller is allowed to triage, or raise."""
        if notification_id < 1:
            raise HTTPException(status_code=400, detail="Invalid notification ID")
        notification = crud.get_notification(db, notification_id=notification_id)
        if notification is None:
            raise HTTPException(status_code=404, detail="Notification not found")
        if notification.user_id != current_user.id and not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="Access denied")
        return notification

    @app.post("/inbox/{notification_id}/snooze", response_model=schemas.Notification)
    def snooze_inbox_item(
        notification_id: int,
        request: schemas.InboxSnoozeRequest,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Defer an item until ``until`` (Open → Snoozed); it returns to open on its own."""
        _owned_notification(db, notification_id, current_user)
        notification = crud.snooze_notification(db, notification_id=notification_id, until=request.until)
        _record_inbox_observability(
            db,
            current_user,
            action="snooze",
            affected_count=1,
            notification_id=notification_id,
            metadata={"until": request.until.isoformat()},
        )
        return notification

    @app.post("/inbox/{notification_id}/unsnooze", response_model=schemas.Notification)
    def unsnooze_inbox_item(
        notification_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Clear a snooze, returning the item to the open inbox now."""
        _owned_notification(db, notification_id, current_user)
        notification = crud.unsnooze_notification(db, notification_id=notification_id)
        _record_inbox_observability(
            db,
            current_user,
            action="unsnooze",
            affected_count=1,
            notification_id=notification_id,
        )
        return notification

    @app.post("/inbox/bulk", response_model=schemas.InboxBulkResult)
    def bulk_inbox(
        request: schemas.InboxBulkAction,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Apply one triage action (archive/unarchive/read/unread/snooze) to a
        multi-selection. Scoped to the caller's own actionable items, so foreign
        or non-inbox ids are silently skipped."""
        try:
            count = crud.bulk_inbox_action(
                db,
                user_id=current_user.id,
                notification_ids=request.ids,
                action=request.action,
                actionable_categories=_actionable_keys(),
                until=request.until,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        _record_inbox_observability(
            db,
            current_user,
            action=f"bulk_{request.action}",
            affected_count=count,
            metadata={"ids": request.ids, "until": request.until.isoformat() if request.until else None},
        )
        if request.action == "archive":
            _record_inbox_zero_if_reached(db, current_user)
        return schemas.InboxBulkResult(affected_count=count)

    def _record_inbox_observability(
        db: Session,
        current_user,
        *,
        action: str,
        affected_count: int,
        notification_id: Optional[int] = None,
        metadata: Optional[dict] = None,
    ) -> None:
        event = {
            "action": action,
            "affected_count": affected_count,
            "notification_id": notification_id,
            "metadata": metadata or {},
        }
        logger.info("work_inbox_action", extra={"user_id": current_user.id, **event})
        try:
            from ..models import AuditAction, EntityType
            from ..schemas_audit import AuditTrailCreate
            from ..services.audit_service import get_audit_service

            audit_action = AuditAction.UPDATE
            if action in {"archive", "archive_all", "bulk_archive"}:
                audit_action = AuditAction.ARCHIVE
            elif action in {"unarchive", "bulk_unarchive"}:
                audit_action = AuditAction.RESTORE
            get_audit_service(db).create_audit_trail(AuditTrailCreate(
                user_id=current_user.id,
                action=audit_action,
                entity_type=EntityType.NOTIFICATION,
                entity_id=notification_id,
                description=f"Work Inbox action: {action}",
                additional_metadata=event,
            ))
        except Exception:
            db.rollback()
            logger.exception("Failed to record Work Inbox audit event")

    def _record_inbox_zero_if_reached(db: Session, current_user) -> None:
        total_open, _total_unread, _total_snoozed, _per_category = crud.get_inbox_summary(
            db, user_id=current_user.id, actionable_categories=_actionable_keys()
        )
        if total_open == 0:
            logger.info("work_inbox_zero_achieved", extra={"user_id": current_user.id})
