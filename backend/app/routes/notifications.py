"""
Notification routes for managing user notifications.
"""

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from .. import crud, schemas, auth, rbac
from ..database import get_db
from ..auth import get_current_active_user


def register_notifications_routes(app):
    """Register notification routes with the FastAPI app."""
    
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
