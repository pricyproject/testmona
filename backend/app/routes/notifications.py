"""
Notification routes for managing user notifications.
"""

import queue as _queue
import time

from fastapi import Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List, Optional

from .. import crud, schemas, auth, rbac, models
from ..config import settings
from ..database import get_db
from ..auth import get_current_active_user
from ..services import notification_engine, digest_service, realtime_service


def register_notifications_routes(app):
    """Register notification routes with the FastAPI app."""

    # Registered before "/notifications/{notification_id}" so the literal "stream"
    # segment is matched here rather than parsed as a (non-integer) id.
    @app.get("/notifications/stream", tags=["Notifications"])
    def stream_notifications(
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Server-Sent Events stream that pushes a 'refetch' ping to the bell.

        Each event is contentless — it tells the client "something changed, pull
        the latest notifications" rather than duplicating the row over the wire, so
        the authoritative ``/notifications`` data stays the single source of truth.
        A periodic heartbeat keeps the connection alive through proxies, and the
        stream caps its own lifetime so worker threads recycle (the browser's
        EventSource transparently reconnects). Realtime is a latency optimisation
        layered on top of the existing polling, never a correctness requirement.
        """
        if not settings.realtime_sse_enabled:
            raise HTTPException(status_code=404, detail="Realtime stream is disabled")

        user_id = current_user.id
        q = realtime_service.subscribe(user_id)

        def event_stream():
            # Cap a single connection at ~25 min so threadpool workers recycle;
            # EventSource reconnects automatically and seamlessly.
            deadline = time.monotonic() + 25 * 60
            try:
                yield ": connected\n\n"
                while time.monotonic() < deadline:
                    try:
                        event = q.get(timeout=20)
                        yield f"event: {event}\ndata: 1\n\n"
                    except _queue.Empty:
                        yield ": ping\n\n"  # heartbeat
            finally:
                realtime_service.unsubscribe(user_id, q)

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                # Disable proxy buffering (nginx) so events flush immediately.
                "X-Accel-Buffering": "no",
            },
        )

    @app.post("/notifications/", response_model=schemas.Notification)
    def create_notification(
        notification: schemas.NotificationCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return crud.create_notification(db=db, notification=notification)

    @app.get("/notifications/{notification_id}", response_model=schemas.Notification)
    def read_notification(
        notification_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Validate notification_id
        if notification_id < 1:
            raise HTTPException(status_code=400, detail="Invalid notification ID")
        
        notification = crud.get_notification(db, notification_id=notification_id)
        if notification is None:
            raise HTTPException(status_code=404, detail="Notification not found")

        if notification.user_id != current_user.id and not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="Access denied")

        return notification

    @app.put("/notifications/{notification_id}", response_model=schemas.Notification)
    def update_notification(
        notification_id: int,
        notification: schemas.NotificationUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Validate notification_id
        if notification_id < 1:
            raise HTTPException(status_code=400, detail="Invalid notification ID")
        
        db_notification = crud.get_notification(db, notification_id=notification_id)
        if db_notification is None:
            raise HTTPException(status_code=404, detail="Notification not found")

        if db_notification.user_id != current_user.id and not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="Access denied")

        return crud.update_notification(db, notification_id=notification_id, notification=notification)

    @app.delete("/notifications/all")
    def delete_all_notifications(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Delete all notifications for the current user"""
        deleted_count = crud.delete_all_notifications(db, user_id=current_user.id)
        return {"message": f"Deleted {deleted_count} notifications", "deleted_count": deleted_count}

    @app.delete("/notifications/cleanup")
    def cleanup_old_notifications(
        days_old: int = 30,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Delete old read notifications for the current user"""
        # Validate days_old parameter
        if days_old < 1:
            raise HTTPException(status_code=400, detail="days_old must be at least 1")
        if days_old > 365:
            raise HTTPException(status_code=400, detail="days_old cannot exceed 365 days")

        deleted_count = crud.delete_old_notifications(db, user_id=current_user.id, days_old=days_old)
        return {"message": f"Deleted {deleted_count} old notifications", "deleted_count": deleted_count}

    @app.delete("/notifications/bulk-delete")
    def bulk_delete_notifications(
        request: schemas.BulkNotificationDelete,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Bulk delete notifications"""
        if not request.notification_ids:
            raise HTTPException(status_code=400, detail="notification_ids list is required")
        if len(request.notification_ids) > 100:
            raise HTTPException(status_code=400, detail="Cannot delete more than 100 notifications at once")

        deleted_count = crud.bulk_delete_notifications(db, user_id=current_user.id, notification_ids=request.notification_ids)
        return {"message": f"Deleted {deleted_count} notifications", "deleted_count": deleted_count}

    @app.delete("/notifications/{notification_id}")
    def delete_notification(
        notification_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Validate notification_id
        if notification_id < 1:
            raise HTTPException(status_code=400, detail="Invalid notification ID")

        db_notification = crud.get_notification(db, notification_id=notification_id)
        if db_notification is None:
            raise HTTPException(status_code=404, detail="Notification not found")

        if db_notification.user_id != current_user.id and not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="Access denied")

        crud.delete_notification(db, notification_id=notification_id)
        return {"message": "Notification deleted successfully"}

    @app.put("/notifications/{notification_id}/mark-unread", response_model=schemas.Notification)
    def mark_notification_as_unread(
        notification_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Validate notification_id
        if notification_id < 1:
            raise HTTPException(status_code=400, detail="Invalid notification ID")
        
        db_notification = crud.get_notification(db, notification_id=notification_id)
        if db_notification is None:
            raise HTTPException(status_code=404, detail="Notification not found")

        if db_notification.user_id != current_user.id and not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="Access denied")

        return crud.mark_notification_as_unread(db, notification_id=notification_id)

    @app.get("/notifications/unread/count")
    def get_unread_notification_count(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        count = crud.get_unread_notification_count(db, user_id=current_user.id)
        return {"unread_count": count}

    @app.post("/notifications/mark-all-read")
    def mark_all_notifications_as_read(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        count = crud.mark_all_notifications_as_read(db, user_id=current_user.id)
        return {"message": "All notifications marked as read", "marked_count": count}

    @app.get("/notifications/", response_model=List[schemas.Notification])
    def read_notifications(
        skip: int = 0,
        limit: int = 100,
        notification_type: Optional[str] = None,
        search: Optional[str] = None,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Validate pagination parameters
        if skip < 0:
            raise HTTPException(status_code=400, detail="skip parameter must be non-negative")
        if limit < 1:
            raise HTTPException(status_code=400, detail="limit parameter must be at least 1")
        if limit > 100:
            raise HTTPException(status_code=400, detail="limit parameter cannot exceed 100")
        
        # Use combined filter and search if both parameters provided
        if notification_type and search:
            return crud.get_notifications_filtered_and_searched(db, user_id=current_user.id, notification_type=notification_type, search_query=search, skip=skip, limit=limit)
        if notification_type:
            return crud.get_notifications_filtered(db, user_id=current_user.id, notification_type=notification_type, skip=skip, limit=limit)
        if search:
            return crud.search_notifications(db, user_id=current_user.id, search_query=search, skip=skip, limit=limit)
        
        return crud.get_notifications(db, user_id=current_user.id, skip=skip, limit=limit)

    @app.post("/notifications/bulk-update")
    def bulk_update_notifications(
        request: schemas.BulkNotificationUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Bulk update notifications (mark as read/unread)"""
        if not request.notification_ids:
            raise HTTPException(status_code=400, detail="notification_ids list is required")
        if len(request.notification_ids) > 100:
            raise HTTPException(status_code=400, detail="Cannot update more than 100 notifications at once")
        
        updated_count = crud.bulk_update_notifications(db, user_id=current_user.id, notification_ids=request.notification_ids, is_read=request.is_read)
        return {"message": f"Updated {updated_count} notifications", "updated_count": updated_count}

    @app.get("/notification-settings/", response_model=schemas.NotificationSettings)
    def get_notification_settings(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        settings = crud.get_notification_settings(db, user_id=current_user.id)
        if not settings:
            # Create default settings if none exist
            default_settings = schemas.NotificationSettingsCreate(
                created_by=current_user.id
            )
            settings = crud.create_notification_settings(db=db, settings=default_settings)
        return settings

    @app.put("/notification-settings/{settings_id}", response_model=schemas.NotificationSettings)
    def update_notification_settings(
        settings_id: int,
        settings: schemas.NotificationSettingsUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_settings = crud.get_notification_settings(db, user_id=current_user.id)
        if not db_settings:
            raise HTTPException(status_code=404, detail="Notification settings not found")
        
        if db_settings.id != settings_id:
            raise HTTPException(status_code=403, detail="Access denied")

        return crud.update_notification_settings(db, settings_id=settings_id, settings=settings)

    @app.get("/notification-preferences", response_model=schemas.NotificationPreferencesResponse)
    def get_notification_preferences(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Return the per-category delivery grid for the current user.

        Every engine category is listed; categories the user has never customised
        default to delivered (in-app + email on). The Settings page renders this
        directly — the registry, not the stored rows, is the source of truth for
        *which* categories exist, so a new category appears automatically.
        """
        saved = {
            p.category: p
            for p in db.query(models.NotificationPreference)
            .filter(models.NotificationPreference.user_id == current_user.id)
            .all()
        }
        categories = []
        for cat in notification_engine.all_categories():
            pref = saved.get(cat.key)
            categories.append(
                schemas.NotificationCategoryInfo(
                    key=cat.key,
                    label=cat.label,
                    actionable=cat.actionable,
                    in_app=pref.in_app if pref is not None else True,
                    email=pref.email if pref is not None else True,
                )
            )
        return schemas.NotificationPreferencesResponse(categories=categories)

    @app.put("/notification-preferences", response_model=schemas.NotificationPreferencesResponse)
    def update_notification_preferences(
        payload: schemas.NotificationPreferencesPut,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Upsert the current user's per-category delivery preferences.

        Each supplied category is validated against the engine registry so the
        table never accumulates keys the engine doesn't know. Rows are upserted in
        place; categories the user leaves at their defaults simply have no row.
        """
        valid_keys = {c.key for c in notification_engine.all_categories()}
        unknown = sorted({p.category for p in payload.preferences} - valid_keys)
        if unknown:
            raise HTTPException(
                status_code=400, detail=f"Unknown notification categories: {unknown}"
            )

        existing = {
            p.category: p
            for p in db.query(models.NotificationPreference)
            .filter(models.NotificationPreference.user_id == current_user.id)
            .all()
        }
        for entry in payload.preferences:
            row = existing.get(entry.category)
            if row is None:
                row = models.NotificationPreference(
                    user_id=current_user.id, category=entry.category
                )
                db.add(row)
                existing[entry.category] = row
            row.in_app = entry.in_app
            row.email = entry.email
        db.commit()

        return get_notification_preferences(db=db, current_user=current_user)

    @app.post("/admin/notifications/weekly-digest", tags=["Notifications"])
    def trigger_weekly_digest(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Send the weekly unread-notification digest to every active user.

        Admin-only. Intended to be invoked by a scheduler/cron (this app has no
        in-process scheduler). Returns a run summary; a no-op reporting ``sent=0``
        when email is not configured.
        """
        if not rbac.has_permission(current_user, "manage_users"):
            raise HTTPException(status_code=403, detail="Only admins can run the digest")
        summary = digest_service.send_weekly_digests(db)
        return {"message": "Weekly digest run complete", **summary}

    @app.post("/admin/announcements", response_model=schemas.AnnouncementResult)
    def create_announcement(
        announcement: schemas.AnnouncementCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Broadcast an admin announcement as a bell-only SYSTEM notification.

        Admin-only. The audience is either every active user (``all``) or the
        members of a single project (``project`` — its owner plus assignees). The
        SYSTEM category is informational and does not coalesce, so each announcement
        is its own row; the engine still excludes the sender and honours each
        recipient's per-category mute.
        """
        if not rbac.has_permission(current_user, "manage_users"):
            raise HTTPException(
                status_code=403, detail="Only admins can send announcements"
            )

        if announcement.audience == "project":
            project = (
                db.query(models.Project)
                .filter(models.Project.id == announcement.project_id)
                .first()
            )
            if project is None:
                raise HTTPException(status_code=404, detail="Project not found")
            assignee_ids = [
                uid
                for (uid,) in db.query(models.ProjectAssignment.user_id)
                .filter(models.ProjectAssignment.project_id == project.id)
                .all()
            ]
            recipient_ids = set(assignee_ids)
            if project.owner_id:
                recipient_ids.add(project.owner_id)
        else:
            recipient_ids = {
                uid
                for (uid,) in db.query(models.User.id)
                .filter(models.User.is_active == True)  # noqa: E712
                .all()
            }

        rows = notification_engine.emit(
            db,
            category=notification_engine.SYSTEM,
            user_ids=list(recipient_ids),
            actor_id=current_user.id,
            title=announcement.title,
            message=announcement.message,
            related_entity_type=("project" if announcement.audience == "project" else None),
            related_entity_id=(announcement.project_id if announcement.audience == "project" else None),
        )
        return schemas.AnnouncementResult(
            message=f"Announcement sent to {len(rows)} user(s)",
            audience=announcement.audience,
            project_id=announcement.project_id,
            notified_count=len(rows),
        )
