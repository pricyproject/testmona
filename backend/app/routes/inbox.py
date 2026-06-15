"""Work Inbox routes.

The Work Inbox is the actionable slice of a user's notifications — mentions,
assignments, review requests, and feedback — presented as a personal task queue
they can triage (mark read) and clear (archive/done). Membership is decided by the
notification engine's category registry, not hard-coded here, so adding a new
actionable category automatically surfaces it in the inbox.
"""

from typing import Optional

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..database import get_db
from ..auth import get_current_active_user
from ..services import notification_engine


def register_inbox_routes(app):
    """Register Work Inbox routes with the FastAPI app."""

    def _actionable_keys():
        return notification_engine.actionable_category_keys()

    @app.get("/inbox", response_model=list[schemas.Notification])
    def list_inbox(
        status: str = Query("open", pattern="^(open|snoozed|done|all)$"),
        category: Optional[str] = None,
        unread_only: bool = False,
        sort: str = Query("newest", pattern="^(newest|oldest)$"),
        skip: int = Query(0, ge=0),
        limit: int = Query(50, ge=1, le=100),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        # Lazy sweep: return any due-snooze items to open before reading the page.
        crud.sweep_due_snoozes(db, user_id=current_user.id)
        items = crud.get_inbox_notifications(
            db,
            user_id=current_user.id,
            actionable_categories=_actionable_keys(),
            status=status,
            category=category,
            unread_only=unread_only,
            sort=sort,
            skip=skip,
            limit=limit,
        )
        crud.resolve_actor_names(db, items)
        crud.resolve_inbox_projects(db, items)
        return items

    @app.get("/inbox/summary", response_model=schemas.InboxSummary)
    def inbox_summary(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        # Keep counts honest by resurfacing due-snooze items first.
        crud.sweep_due_snoozes(db, user_id=current_user.id)
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
        return {"message": f"Marked {count} items read", "marked_count": count}

    @app.post("/inbox/{notification_id}/archive", response_model=schemas.Notification)
    def archive_inbox_item(
        notification_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        return _set_archived(db, notification_id, current_user, archived=True)

    @app.post("/inbox/{notification_id}/unarchive", response_model=schemas.Notification)
    def unarchive_inbox_item(
        notification_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        return _set_archived(db, notification_id, current_user, archived=False)

    def _set_archived(db: Session, notification_id: int, current_user, archived: bool):
        if notification_id < 1:
            raise HTTPException(status_code=400, detail="Invalid notification ID")
        notification = crud.get_notification(db, notification_id=notification_id)
        if notification is None:
            raise HTTPException(status_code=404, detail="Notification not found")
        if notification.user_id != current_user.id and not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="Access denied")
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
        return crud.snooze_notification(db, notification_id=notification_id, until=request.until)

    @app.post("/inbox/{notification_id}/unsnooze", response_model=schemas.Notification)
    def unsnooze_inbox_item(
        notification_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Clear a snooze, returning the item to the open inbox now."""
        _owned_notification(db, notification_id, current_user)
        return crud.unsnooze_notification(db, notification_id=notification_id)

    @app.post("/inbox/bulk", response_model=schemas.InboxBulkResult)
    def bulk_inbox(
        request: schemas.InboxBulkAction,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Apply one triage action (archive/unarchive/read/unread/snooze) to a
        multi-selection. Scoped to the caller's own actionable items, so foreign
        or non-inbox ids are silently skipped."""
        count = crud.bulk_inbox_action(
            db,
            user_id=current_user.id,
            notification_ids=request.ids,
            action=request.action,
            actionable_categories=_actionable_keys(),
            until=request.until,
        )
        return schemas.InboxBulkResult(affected_count=count)
