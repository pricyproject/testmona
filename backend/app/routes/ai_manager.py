"""
AI provider management routes.
"""

import logging

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import check_password_change_required, get_current_active_user
from ..database import get_db
from ..models import Role
from ..services.ai_manager import (
    AICompletionRequest,
    AIManagerSettingsPayload,
    AITestRequest,
    clear_ai_recent_events,
    generate_ai_completion,
    get_ai_manager_settings,
    get_ai_manager_status,
    get_ai_usage,
    reset_ai_usage,
    update_ai_manager_settings,
)

logger = logging.getLogger(__name__)


def _require_admin(current_user: schemas.User) -> None:
    if isinstance(current_user.role, str):
        is_admin = current_user.role.lower() == Role.ADMIN.value
    else:
        is_admin = current_user.role == Role.ADMIN
    if not is_admin and not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not authorized to manage AI settings")


def _audit_ai_manager_change(db: Session, current_user: schemas.User, description: str) -> None:
    try:
        from ..models import AuditAction, EntityType
        from ..schemas_audit import AuditTrailCreate
        from ..services.audit_service import get_audit_service

        get_audit_service(db).create_audit_trail(
            AuditTrailCreate(
                user_id=current_user.id,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.SYSTEM_SETTING.value,
                entity_id=None,
                project_id=None,
                description=description,
            )
        )
    except Exception as exc:
        logger.exception("Failed to create audit trail for AI manager change: %s", exc)


def register_ai_manager_routes(app):
    """Register AI manager routes with the FastAPI app."""

    @app.get("/ai-manager/settings")
    def read_ai_manager_settings(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        check_password_change_required(current_user)
        _require_admin(current_user)
        return get_ai_manager_settings(db)

    @app.get("/ai-manager/status")
    def read_ai_manager_status(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        check_password_change_required(current_user)
        return get_ai_manager_status(db)

    @app.put("/ai-manager/settings")
    def save_ai_manager_settings(
        payload: AIManagerSettingsPayload,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        check_password_change_required(current_user)
        _require_admin(current_user)
        settings = update_ai_manager_settings(db, payload)
        _audit_ai_manager_change(db, current_user, "AI manager settings updated")
        return settings

    @app.get("/ai-manager/usage")
    def read_ai_usage(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        check_password_change_required(current_user)
        _require_admin(current_user)
        return get_ai_usage(db)

    @app.delete("/ai-manager/usage")
    def reset_ai_usage_statistics(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        check_password_change_required(current_user)
        _require_admin(current_user)
        usage = reset_ai_usage(db)
        _audit_ai_manager_change(db, current_user, "AI manager usage statistics reset")
        return usage

    @app.delete("/ai-manager/recent-actions")
    def clear_recent_ai_actions(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        check_password_change_required(current_user)
        _require_admin(current_user)
        usage = clear_ai_recent_events(db)
        _audit_ai_manager_change(db, current_user, "AI manager recent actions cleared")
        return usage

    @app.post("/ai-manager/test")
    async def test_ai_provider(
        payload: AITestRequest,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        check_password_change_required(current_user)
        _require_admin(current_user)
        result = await generate_ai_completion(
            db,
            AICompletionRequest(
                provider=payload.provider,
                prompt=payload.prompt,
                max_tokens=80,
                temperature=0,
            ),
            operation="connection_test",
            user_id=current_user.id,
        )
        return {
            "success": True,
            "provider": result.provider,
            "model": result.model,
            "message": result.content,
            "usage": {
                "prompt_tokens": result.prompt_tokens,
                "completion_tokens": result.completion_tokens,
                "total_tokens": result.total_tokens,
            },
        }
