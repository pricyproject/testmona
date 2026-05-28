"""
System settings routes for managing system-wide configuration.
"""

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
import json
import logging
import re
from urllib.parse import urlparse

from .. import crud, schemas, auth, rbac
from ..database import get_db
from ..auth import get_current_active_user, check_password_change_required
from ..models import EntityType

logger = logging.getLogger(__name__)

DEFAULT_PUBLIC_SETTINGS = {
    "signup_enabled": {
        "value": "true",
        "description": "Whether public registration is enabled",
    },
    "app_name": {
        "value": "TestMona",
        "description": "Application display name",
    },
    "app_logo_url": {
        "value": "",
        "description": "Application logo URL",
    },
    "organization_name": {
        "value": "",
        "description": "Organization display name",
    },
    "support_email": {
        "value": "",
        "description": "Public support email address",
    },
    "demo_credentials_enabled": {
        "value": "true",
        "description": "Whether demo credentials are shown on login page",
    },
}

APP_NAME_MAX_LENGTH = 80
APP_LOGO_URL_MAX_LENGTH = 500
ORGANIZATION_NAME_MAX_LENGTH = 120
SUPPORT_EMAIL_MAX_LENGTH = 254
ALLOWED_PASSWORD_COMPLEXITIES = {"low", "medium", "high"}
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def validate_system_setting_value(key: str, value: str | None) -> str | None:
    """Validate and normalize known system setting values."""
    if key == "app_name" and value is None:
        raise HTTPException(status_code=400, detail="Application name is required")

    normalized_value = value.strip() if value is not None else None

    if key == "app_name":
        if not normalized_value:
            raise HTTPException(status_code=400, detail="Application name is required")
        if len(normalized_value) > APP_NAME_MAX_LENGTH:
            raise HTTPException(
                status_code=400,
                detail=f"Application name must be {APP_NAME_MAX_LENGTH} characters or fewer",
            )
        return normalized_value

    if key == "app_logo_url":
        if not normalized_value:
            return ""
        if len(normalized_value) > APP_LOGO_URL_MAX_LENGTH:
            raise HTTPException(
                status_code=400,
                detail=f"Logo URL must be {APP_LOGO_URL_MAX_LENGTH} characters or fewer",
            )
        parsed_url = urlparse(normalized_value)
        if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
            raise HTTPException(status_code=400, detail="Logo URL must be a valid HTTP or HTTPS URL")
        return normalized_value

    if key == "organization_name":
        if not normalized_value:
            return ""
        if len(normalized_value) > ORGANIZATION_NAME_MAX_LENGTH:
            raise HTTPException(
                status_code=400,
                detail=f"Organization name must be {ORGANIZATION_NAME_MAX_LENGTH} characters or fewer",
            )
        return normalized_value

    if key == "support_email":
        if not normalized_value:
            return ""
        if len(normalized_value) > SUPPORT_EMAIL_MAX_LENGTH or not EMAIL_PATTERN.match(normalized_value):
            raise HTTPException(status_code=400, detail="Support email must be a valid email address")
        return normalized_value

    if key in {"maintenance_mode", "signup_enabled", "debug_logging"}:
        if normalized_value not in {"true", "false"}:
            raise HTTPException(status_code=400, detail=f"{key} must be true or false")
        return normalized_value

    if key == "session_timeout":
        try:
            timeout_minutes = int(normalized_value or "")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Session timeout must be a number") from exc
        if timeout_minutes < 1 or timeout_minutes > 1440:
            raise HTTPException(status_code=400, detail="Session timeout must be between 1 and 1440 minutes")
        return str(timeout_minutes)

    if key == "password_complexity":
        if normalized_value not in ALLOWED_PASSWORD_COMPLEXITIES:
            raise HTTPException(status_code=400, detail="Password complexity must be low, medium, or high")
        return normalized_value

    if key == "default_timezone":
        if not normalized_value or len(normalized_value) > 80:
            raise HTTPException(status_code=400, detail="Default timezone is required and must be 80 characters or fewer")
        return normalized_value

    return value


def register_system_settings_routes(app):
    """Register system settings routes with the FastAPI app."""
    
    # Demo credentials status endpoint (must be before generic {key} route)
    @app.get("/system/settings/public/demo-credentials-status")
    def get_demo_credentials_status(db: Session = Depends(get_db)):
        """Check if demo credentials should be shown on login page.
        
        Returns false if any admin user has changed their default password (force_password_change = false),
        indicating that the system has been configured and demo credentials should be hidden.
        Returns true if all admin users still have force_password_change = true, indicating fresh install.
        
        SECURITY: This endpoint is safe to expose publicly as it only reveals whether demo credentials
        should be shown, not sensitive user information.
        """
        try:
            from ..models import User, Role
            
            # Check if any admin user has changed their password
            admin_with_changed_password = db.query(User).filter(
                User.role == Role.ADMIN.value,
                User.force_password_change == False
            ).first()
            
            # If any admin has changed their password, hide demo credentials
            show_demo_credentials = admin_with_changed_password is None
            
            return {
                "show_demo_credentials": show_demo_credentials,
                "reason": "fresh_install" if show_demo_credentials else "password_changed"
            }
        except Exception as e:
            logger.error(f"Error checking demo credentials status: {e}")
            # Default to showing demo credentials on error
            return {
                "show_demo_credentials": True,
                "reason": "error"
            }
    
    # Public endpoint for settings that need to be accessible without authentication
    # SECURITY NOTE: Only add settings here that are safe to expose to unauthenticated users
    # This endpoint should NOT expose sensitive configuration, secrets, or internal system details
    @app.get("/system/settings/public/{key}")
    def get_public_system_setting(key: str, db: Session = Depends(get_db)):
        """Get a system setting that is publicly accessible (no auth required).
        
        SECURITY: Only settings that are safe for public consumption should be accessible here.
        Currently allowed: signup_enabled (to show/hide signup button), public branding settings
        
        Do NOT add settings that could:
        - Reveal system configuration details
        - Expose internal infrastructure information
        - Help attackers enumerate the system
        - Contain sensitive data
        
        SECURITY CONSIDERATIONS:
        - This is a GET endpoint and must be idempotent (no database writes)
        - Returns default values for missing settings instead of creating them
        - Whitelist approach prevents unauthorized setting access
        - Input validation prevents injection attacks
        - 404 responses prevent setting enumeration
        """
        # Only allow specific public settings - whitelist approach for security
        public_settings = set(DEFAULT_PUBLIC_SETTINGS.keys())
        
        # Validate key format to prevent path traversal or injection
        if not key or not isinstance(key, str) or not key.replace('_', '').replace('-', '').isalnum():
            raise HTTPException(status_code=400, detail="Invalid setting key format")
        
        if key not in public_settings:
            # Return 404 instead of 403 to avoid setting enumeration
            raise HTTPException(status_code=404, detail="Setting not found")
        
        setting = crud.get_system_setting(db, key=key)
        if setting is None:
            # Return default value without writing to database (GET must be idempotent)
            # The setting should be created during database initialization/seeding
            if key in DEFAULT_PUBLIC_SETTINGS:
                return {
                    "key": key,
                    **DEFAULT_PUBLIC_SETTINGS[key],
                }
            raise HTTPException(status_code=404, detail="Setting not found")
        
        # Return only the necessary fields (exclude internal metadata)
        return {
            "key": setting.key,
            "value": setting.value,
            "description": setting.description
        }
    
    @app.get("/system/settings", response_model=List[schemas.SystemSettings])
    def get_system_settings(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: schemas.User = Depends(get_current_active_user)):
        # Only admins can view system settings
        from ..models import Role
        if isinstance(current_user.role, str):
            is_admin = current_user.role.lower() == Role.ADMIN.value
        else:
            is_admin = current_user.role == Role.ADMIN
        
        if not is_admin and not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="Not authorized to view system settings")
        
        return crud.get_system_settings(db, skip=skip, limit=limit)

    # Audit Trail Configuration Endpoints (must be defined before generic {key} endpoint)
    @app.get("/system/settings/audit-trail-config", response_model=schemas.AuditTrailConfig)
    def get_audit_trail_config(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get audit trail configuration (admin only)"""
        # Only admins can view audit trail configuration
        from ..models import Role
        if isinstance(current_user.role, str):
            is_admin = current_user.role.lower() == Role.ADMIN.value
        else:
            is_admin = current_user.role == Role.ADMIN
        
        if not is_admin and not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="Not authorized to view audit trail configuration")
        
        # Get the audit trail config from system settings
        setting = crud.get_system_setting(db, key="audit_trail_config")
        if setting is None:
            # Return default configuration
            return schemas.AuditTrailConfig(enabled=True, entity_settings={})
        
        try:
            config_data = json.loads(setting.value) if setting.value else {}
            return schemas.AuditTrailConfig(**config_data)
        except (json.JSONDecodeError, TypeError) as e:
            # If the value is invalid, return default
            return schemas.AuditTrailConfig(enabled=True, entity_settings={})

    @app.get("/system/settings/{key}", response_model=schemas.SystemSettings)
    def get_system_setting(key: str, db: Session = Depends(get_db), current_user: schemas.User = Depends(get_current_active_user)):
        setting = crud.get_system_setting(db, key=key)
        if setting is None:
            raise HTTPException(status_code=404, detail="Setting not found")
        return setting

    @app.post("/system/settings", response_model=schemas.SystemSettings)
    def create_system_setting(
        setting: schemas.SystemSettingsCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Only admins can create system settings
        from ..models import Role
        if isinstance(current_user.role, str):
            is_admin = current_user.role.lower() == Role.ADMIN.value
        else:
            is_admin = current_user.role == Role.ADMIN
        
        if not is_admin and not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="Not authorized to create system settings")

        setting.value = validate_system_setting_value(setting.key, setting.value)
        
        db_setting = crud.create_system_setting(db=db, setting=setting)
        if db_setting is None:
            raise HTTPException(status_code=409, detail="Setting with this key already exists")
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.SYSTEM_SETTING.value,
                entity_id=db_setting.id,
                project_id=None,
                description=f"System setting created: {db_setting.key}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            logger.exception("Failed to create audit trail for system setting creation: %s", e)
        
        return db_setting

    @app.put("/system/settings/audit-trail-config", response_model=schemas.AuditTrailConfig)
    def update_audit_trail_config(
        config_update: schemas.AuditTrailConfigUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Update audit trail configuration (admin only)"""
        # Check if user needs to change password
        check_password_change_required(current_user)
        
        # Only admins can update audit trail configuration
        from ..models import Role
        if isinstance(current_user.role, str):
            is_admin = current_user.role.lower() == Role.ADMIN.value
        else:
            is_admin = current_user.role == Role.ADMIN
        
        if not is_admin and not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="Not authorized to update audit trail configuration")
        
        # Get current configuration
        setting = crud.get_system_setting(db, key="audit_trail_config")
        current_config = {}
        if setting and setting.value:
            try:
                current_config = json.loads(setting.value)
            except (json.JSONDecodeError, TypeError):
                current_config = {}
        
        # Update configuration with new values
        if config_update.enabled is not None:
            current_config["enabled"] = config_update.enabled
        if config_update.entity_settings is not None:
            if "entity_settings" not in current_config:
                current_config["entity_settings"] = {}
            current_config["entity_settings"].update(config_update.entity_settings)
        
        # Save the updated configuration
        config_json = json.dumps(current_config)
        if setting:
            db_setting = crud.update_system_setting(
                db=db,
                key="audit_trail_config",
                setting=schemas.SystemSettingsUpdate(value=config_json)
            )
        else:
            db_setting = crud.create_system_setting(
                db=db,
                setting=schemas.SystemSettingsCreate(
                    key="audit_trail_config",
                    value=config_json,
                    description="Audit trail configuration for enabling/disabling audit logs per entity type"
                )
            )
        
        # Create audit trail for this configuration change
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.SYSTEM_SETTING.value,
                entity_id=db_setting.id,
                project_id=None,
                description=f"Audit trail configuration updated",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for audit config update: {e}")
        
        return schemas.AuditTrailConfig(**current_config)

    @app.post("/system/settings/audit-trail-config/reset", response_model=schemas.AuditTrailConfig)
    def reset_audit_trail_config(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Reset audit trail configuration to defaults (admin only)"""
        # Check if user needs to change password
        check_password_change_required(current_user)
        
        # Only admins can reset audit trail configuration
        from ..models import Role
        if isinstance(current_user.role, str):
            is_admin = current_user.role.lower() == Role.ADMIN.value
        else:
            is_admin = current_user.role == Role.ADMIN
        
        if not is_admin and not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="Not authorized to reset audit trail configuration")
        
        # Reset to default configuration
        default_config = {"enabled": True, "entity_settings": {}}
        config_json = json.dumps(default_config)
        
        setting = crud.get_system_setting(db, key="audit_trail_config")
        if setting:
            db_setting = crud.update_system_setting(
                db=db,
                key="audit_trail_config",
                setting=schemas.SystemSettingsUpdate(value=config_json)
            )
        else:
            db_setting = crud.create_system_setting(
                db=db,
                setting=schemas.SystemSettingsCreate(
                    key="audit_trail_config",
                    value=config_json,
                    description="Audit trail configuration for enabling/disabling audit logs per entity type"
                )
            )
        
        # Create audit trail for this reset
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.SYSTEM_SETTING.value,
                entity_id=db_setting.id,
                project_id=None,
                description=f"Audit trail configuration reset to defaults",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for audit config reset: {e}")
        
        return schemas.AuditTrailConfig(**default_config)

    @app.delete("/system/settings/audit-trails/all")
    def delete_all_audit_trails(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Delete all audit trail records (admin only)"""
        # Check if user needs to change password
        check_password_change_required(current_user)
        
        # Only admins can delete all audit trails
        from ..models import Role
        if isinstance(current_user.role, str):
            is_admin = current_user.role.lower() == Role.ADMIN.value
        else:
            is_admin = current_user.role == Role.ADMIN
        
        if not is_admin and not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="Not authorized to delete audit trails")
        
        try:
            from ..models import AuditTrail
            # Count before deletion for audit trail
            count = db.query(AuditTrail).count()
            
            # Delete all audit trails
            db.query(AuditTrail).delete()
            db.commit()
            
            # Create audit trail for this deletion
            try:
                from ..services.audit_service import get_audit_service
                from ..schemas_audit import AuditTrailCreate
                from ..models import AuditAction, EntityType
                audit_service = get_audit_service(db)
                audit_data = AuditTrailCreate(
                    user_id=current_user.id if current_user else None,
                    action=AuditAction.DELETE.value,
                    entity_type=EntityType.SYSTEM_SETTING.value,
                    entity_id=None,
                    project_id=None,
                    description=f"All audit trails deleted ({count} records)",
                )
                audit_service.create_audit_trail(audit_data)
            except Exception as e:
                print(f"Failed to create audit trail for audit deletion: {e}")
            
            return {"message": f"Successfully deleted {count} audit trail records"}
        except Exception as e:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to delete audit trails: {str(e)}")

    @app.put("/system/settings/{key}")
    def update_system_setting(
        key: str,
        setting: schemas.SystemSettingsUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Check if user needs to change password
        check_password_change_required(current_user)
        
        # Only admins can update system settings
        from ..models import Role
        if isinstance(current_user.role, str):
            is_admin = current_user.role.lower() == Role.ADMIN.value
        else:
            is_admin = current_user.role == Role.ADMIN
        
        if not is_admin and not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="Not authorized to update system settings")

        if "value" in setting.model_fields_set:
            setting.value = validate_system_setting_value(key, setting.value)
        
        # Get old value before update
        old_setting = crud.get_system_setting(db, key)
        old_value = old_setting.value if old_setting else None
        
        db_setting = crud.update_system_setting(db=db, key=key, setting=setting)
        if db_setting is None:
            raise HTTPException(status_code=404, detail="Setting not found")
        
        # Create audit trail for signup_enabled changes
        if key == "signup_enabled":
            try:
                from ..services.audit_service import get_audit_service
                from ..schemas_audit import AuditTrailCreate
                audit_service = get_audit_service(db)
                new_value = db_setting.value
                audit_data = AuditTrailCreate(
                    user_id=current_user.id,
                    action="update",
                    entity_type=EntityType.SYSTEM_SETTING,
                    entity_id=db_setting.id,
                    description=f"Signup setting changed from {old_value} to {new_value} by {current_user.username}",
                )
                audit_service.create_audit_trail(audit_data)
            except Exception as audit_error:
                print(f"Failed to create audit trail for signup change: {audit_error}")
        
        return db_setting

    @app.delete("/system/settings/{key}")
    def delete_system_setting(
        key: str,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Only admins can delete system settings
        from ..models import Role
        if isinstance(current_user.role, str):
            is_admin = current_user.role.lower() == Role.ADMIN.value
        else:
            is_admin = current_user.role == Role.ADMIN
        
        if not is_admin and not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="Not authorized to delete system settings")
        
        # Store data for audit trail before deletion
        db_setting = crud.get_system_setting(db, key=key)
        if db_setting is None:
            raise HTTPException(status_code=404, detail="Setting not found")
        
        setting_id = db_setting.id
        setting_key = db_setting.key
        
        db_setting = crud.delete_system_setting(db=db, key=key)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.SYSTEM_SETTING.value,
                entity_id=setting_id,
                project_id=None,
                description=f"System setting deleted: {setting_key}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for system setting deletion: {e}")
        
        return {"message": "System setting deleted successfully"}

    @app.get("/system/settings/signup-history")
    def get_signup_history(
        skip: int = 0,
        limit: int = 50,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get audit trail history for signup_enabled changes"""
        # Only admins can view signup history
        from ..models import Role
        if isinstance(current_user.role, str):
            is_admin = current_user.role.lower() == Role.ADMIN.value
        else:
            is_admin = current_user.role == Role.ADMIN
        
        if not is_admin and not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="Not authorized to view signup history")
        
        # Validate limit
        if limit > 100:
            limit = 100
        
        try:
            from ..services.audit_service import get_audit_service
            from ..models import AuditTrail
            
            audit_service = get_audit_service(db)
            
            # Get audit trails for system_settings entity type with signup_enabled in description
            query = db.query(AuditTrail).filter(
                AuditTrail.entity_type == "system_settings",
                AuditTrail.description.like("%signup%")
            ).order_by(AuditTrail.created_at.desc())
            
            total = query.count()
            audit_trails = query.offset(skip).limit(limit).all()
            
            history = []
            for trail in audit_trails:
                from ..models import User
                user = db.query(User).filter(User.id == trail.user_id).first()
                history.append({
                    "id": trail.id,
                    "description": trail.description,
                    "created_at": trail.created_at.isoformat() if trail.created_at else None,
                    "user": user.username if user else "Unknown",
                    "action": trail.action.value if hasattr(trail.action, 'value') else str(trail.action)
                })
            
            return {
                "history": history,
                "total": total,
                "skip": skip,
                "limit": limit
            }
        except Exception as e:
            print(f"Failed to get signup history: {e}")
            return {"history": [], "total": 0, "skip": skip, "limit": limit}

    # Global Parameters Endpoints
    @app.post("/global-parameters/", response_model=schemas.GlobalParameter)
    def create_global_parameter(
        parameter: schemas.GlobalParameterCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # For global parameters (project_id is None), require admin permission
        if parameter.project_id is None:
            if not current_user.is_superuser:
                raise HTTPException(status_code=403, detail="Only admins can create global parameters")
        else:
            if not rbac.has_permission(current_user, "write", parameter.project_id, db):
                raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Names are unique per scope. Check explicitly for a clean 400 (and to
        # cover the global scope, where the (project_id, name) DB constraint
        # doesn't fire because NULL project_ids compare as distinct).
        if crud.get_global_parameter_by_name(db, name=parameter.name, project_id=parameter.project_id) is not None:
            raise HTTPException(status_code=400, detail="A parameter with that name already exists in this scope")

        parameter_data = parameter.model_dump()
        parameter_data["created_by"] = current_user.id
        db_parameter = crud.create_global_parameter(db=db, parameter=parameter_data)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.GLOBAL_PARAMETER.value,
                entity_id=db_parameter.id,
                project_id=db_parameter.project_id,
                description=f"Global parameter created: {db_parameter.name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for global parameter creation: {e}")
        
        return db_parameter

    @app.get("/global-parameters", response_model=List[schemas.GlobalParameter])
    def read_global_parameters(
        project_id: int = None,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        try:
            return crud.get_global_parameters(db, project_id=project_id, skip=skip, limit=limit)
        except Exception as e:
            print(f"Error in read_global_parameters: {e}")
            return []

    @app.get("/global-parameters/{param_id}", response_model=schemas.GlobalParameter)
    def read_global_parameter(
        param_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        parameter = crud.get_global_parameter(db, param_id=param_id)
        if parameter is None:
            raise HTTPException(status_code=404, detail="Global parameter not found")
        
        # For global parameters (project_id is None), require admin permission
        if parameter.project_id is None:
            if not current_user.is_superuser:
                raise HTTPException(status_code=403, detail="Only admins can access global parameters")
        else:
            if not rbac.has_permission(current_user, "read", parameter.project_id, db):
                raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return parameter

    @app.put("/global-parameters/{param_id}", response_model=schemas.GlobalParameter)
    def update_global_parameter(
        param_id: int,
        parameter: schemas.GlobalParameterUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_parameter = crud.get_global_parameter(db, param_id=param_id)
        if db_parameter is None:
            raise HTTPException(status_code=404, detail="Global parameter not found")
        
        # For global parameters (project_id is None), require admin permission
        if db_parameter.project_id is None:
            if not current_user.is_superuser:
                raise HTTPException(status_code=403, detail="Only admins can modify global parameters")
        else:
            if not rbac.has_permission(current_user, "write", db_parameter.project_id, db):
                raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Reject a rename that collides with another parameter in the same scope.
        changes = parameter.model_dump(exclude_unset=True)
        new_name = changes.get("name")
        if new_name is not None and new_name != db_parameter.name:
            conflict = crud.get_global_parameter_by_name(db, name=new_name, project_id=db_parameter.project_id)
            if conflict is not None and conflict.id != db_parameter.id:
                raise HTTPException(status_code=400, detail="A parameter with that name already exists in this scope")

        db_parameter = crud.update_global_parameter(db, param_id=param_id, parameter=changes)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.GLOBAL_PARAMETER.value,
                entity_id=db_parameter.id,
                project_id=db_parameter.project_id,
                description=f"Global parameter updated: {db_parameter.name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for global parameter update: {e}")
        
        return db_parameter

    @app.delete("/global-parameters/{param_id}")
    def delete_global_parameter(
        param_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_parameter = crud.get_global_parameter(db, param_id=param_id)
        if db_parameter is None:
            raise HTTPException(status_code=404, detail="Global parameter not found")
        
        # For global parameters (project_id is None), require admin permission
        if db_parameter.project_id is None:
            if not current_user.is_superuser:
                raise HTTPException(status_code=403, detail="Only admins can delete global parameters")
        else:
            if not rbac.has_permission(current_user, "delete", db_parameter.project_id, db):
                raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        # Store data for audit trail before deletion
        param_id_val = db_parameter.id
        param_name = db_parameter.name
        project_id = db_parameter.project_id
        
        crud.delete_global_parameter(db, param_id=param_id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.GLOBAL_PARAMETER.value,
                entity_id=param_id_val,
                project_id=project_id,
                description=f"Global parameter deleted: {param_name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for global parameter deletion: {e}")
        
        return {"message": "Global parameter deleted successfully"}
