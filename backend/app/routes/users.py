"""
User management routes for user profiles, CRUD operations, and invitations.
"""

from fastapi import Depends, HTTPException, UploadFile
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
import logging

from .. import crud, schemas, auth, crud_rbac, models, rbac
from ..database import get_db
from ..auth import get_current_active_user, check_password_change_required, verify_password, get_password_hash
from ..security_utils import validate_file_size, validate_file_type, MAX_AVATAR_SIZE
from ..utils import sanitize_data


logger = logging.getLogger(__name__)


def _revoke_user_sessions(db: Session, user: models.User) -> None:
    user.session_version = int(user.session_version or 0) + 1
    db.commit()
    auth.revoke_all_user_refresh_tokens(user.id, db)


def register_user_routes(app):
    """Register user management routes with the FastAPI app."""

    def require_manage_users(current_user: models.User) -> None:
        if not rbac.has_permission(current_user, "manage_users"):
            raise HTTPException(status_code=403, detail="Only admins can manage users")
    
    @app.get("/users/check-username/{username}")
    async def check_username_availability(
        username: str,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Check if username is available (not taken by another user)"""
        db_user = crud.get_user_by_username(db, username=username)
        # Username is available if it doesn't exist or belongs to the current user
        is_available = db_user is None or db_user.id == current_user.id
        return {"available": is_available}

    @app.get("/users/check-email/{email}")
    async def check_email_availability(
        email: str,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Check if email is available (not taken by another user)"""
        db_user = crud.get_user_by_email(db, email=email)
        # Email is available if it doesn't exist or belongs to the current user
        is_available = db_user is None or db_user.id == current_user.id
        return {"available": is_available}

    @app.post("/users/me/change-password")
    async def change_password(
        password_data: dict,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Change user password"""
        old_password = password_data.get('old_password')
        new_password = password_data.get('new_password')
        
        if not old_password or not new_password:
            raise HTTPException(status_code=400, detail="Old password and new password are required")
        
        # Verify old password
        if not verify_password(old_password, current_user.hashed_password):
            raise HTTPException(status_code=400, detail="Incorrect old password")
        
        # Validate new password
        if len(new_password) < 8:
            raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
        
        if old_password == new_password:
            raise HTTPException(status_code=400, detail="New password must be different from old password")
        
        # Update password
        current_user.hashed_password = get_password_hash(new_password)
        # Clear force_password_change flag when password is changed (only after successful validation)
        current_user.force_password_change = False
        db.commit()
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.USER.value,
                entity_id=current_user.id,
                project_id=None,
                description=f"Password changed for user: {current_user.username or current_user.email}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for password change: {e}")
        
        # Auto-complete onboarding task if it exists
        try:
            from ..crud import update_onboarding_task
            update_onboarding_task(db, current_user.id, "change_password", True)
        except Exception as e:
            print(f"Failed to update onboarding task: {e}")
        
        return {"message": "Password changed successfully"}

    @app.get("/users/me/2fa", response_model=schemas.TwoFactorStatus)
    async def get_two_factor_status(
        current_user: models.User = Depends(get_current_active_user)
    ):
        """Return the current user's two-factor authentication status."""
        return {"enabled": bool(current_user.two_factor_enabled)}

    @app.post("/users/me/2fa/setup", response_model=schemas.TwoFactorSetupResponse)
    async def setup_two_factor(
        db: Session = Depends(get_db),
        current_user: models.User = Depends(get_current_active_user)
    ):
        """Create a pending TOTP secret for the current user."""
        check_password_change_required(current_user)
        if current_user.two_factor_enabled:
            raise HTTPException(status_code=400, detail="Two-factor authentication is already enabled")

        from ..services.totp_service import encrypt_totp_secret, generate_totp_secret, provisioning_uri

        secret = generate_totp_secret()
        current_user.two_factor_secret = encrypt_totp_secret(secret)
        current_user.two_factor_recovery_codes = None
        db.commit()
        app_name_setting = crud.get_system_setting(db, key="app_name")
        app_name = app_name_setting.value.strip() if app_name_setting and app_name_setting.value else "TestMona"
        logger.info("Two-factor setup secret generated for user_id=%s", current_user.id)
        return {
            "secret": secret,
            "provisioning_uri": provisioning_uri(current_user.email, secret, app_name),
        }

    @app.post("/users/me/2fa/enable", response_model=schemas.TwoFactorEnableResponse)
    async def enable_two_factor(
        payload: schemas.TwoFactorEnableRequest,
        db: Session = Depends(get_db),
        current_user: models.User = Depends(get_current_active_user)
    ):
        """Enable TOTP after verifying the user's password and current code."""
        check_password_change_required(current_user)
        if not verify_password(payload.current_password, current_user.hashed_password):
            logger.warning("Two-factor enable rejected due to invalid password for user_id=%s", current_user.id)
            raise HTTPException(status_code=400, detail="Incorrect password")

        from ..services.totp_service import decrypt_totp_secret, encrypt_recovery_code_hashes, encrypt_totp_secret, generate_recovery_codes, verify_totp

        secret, was_encrypted = decrypt_totp_secret(current_user.two_factor_secret)
        if secret and not was_encrypted:
            current_user.two_factor_secret = encrypt_totp_secret(secret)
            db.commit()

        if not verify_totp(secret, payload.code):
            logger.warning("Two-factor enable rejected due to invalid code for user_id=%s", current_user.id)
            raise HTTPException(status_code=400, detail="Invalid two-factor authentication code")

        recovery_codes = generate_recovery_codes()
        current_user.two_factor_enabled = True
        current_user.two_factor_recovery_codes = encrypt_recovery_code_hashes(recovery_codes)
        _revoke_user_sessions(db, current_user)
        logger.info("Two-factor authentication enabled for user_id=%s", current_user.id)
        return {"enabled": True, "recovery_codes": recovery_codes}

    @app.post("/users/me/2fa/disable", response_model=schemas.TwoFactorStatus)
    async def disable_two_factor(
        payload: schemas.TwoFactorDisableRequest,
        db: Session = Depends(get_db),
        current_user: models.User = Depends(get_current_active_user)
    ):
        """Disable TOTP after verifying the user's password and current code."""
        check_password_change_required(current_user)
        if not current_user.two_factor_enabled:
            return {"enabled": False}
        if not verify_password(payload.current_password, current_user.hashed_password):
            logger.warning("Two-factor disable rejected due to invalid password for user_id=%s", current_user.id)
            raise HTTPException(status_code=400, detail="Incorrect password")

        if not current_user.two_factor_secret:
            current_user.two_factor_enabled = False
            current_user.two_factor_recovery_codes = None
            _revoke_user_sessions(db, current_user)
            logger.warning("Two-factor authentication disabled for user_id=%s because no secret was stored", current_user.id)
            return {"enabled": False}

        from ..services.totp_service import decrypt_totp_secret, encrypt_totp_secret, verify_and_consume_recovery_code, verify_totp

        secret, was_encrypted = decrypt_totp_secret(current_user.two_factor_secret)
        if secret and not was_encrypted:
            current_user.two_factor_secret = encrypt_totp_secret(secret)
            db.commit()

        recovery_code_used = False
        if not verify_totp(secret, payload.code):
            recovery_code_used, updated_recovery_codes = verify_and_consume_recovery_code(
                current_user.two_factor_recovery_codes,
                payload.code,
            )
            if recovery_code_used:
                current_user.two_factor_recovery_codes = updated_recovery_codes

        if not verify_totp(secret, payload.code) and not recovery_code_used:
            logger.warning("Two-factor disable rejected due to invalid code for user_id=%s", current_user.id)
            raise HTTPException(status_code=400, detail="Invalid two-factor authentication code")

        current_user.two_factor_enabled = False
        current_user.two_factor_secret = None
        current_user.two_factor_recovery_codes = None
        _revoke_user_sessions(db, current_user)
        logger.info("Two-factor authentication disabled for user_id=%s", current_user.id)
        return {"enabled": False}

    @app.post("/users/me/2fa/recovery-codes", response_model=schemas.TwoFactorRecoveryCodesResponse)
    async def regenerate_two_factor_recovery_codes(
        payload: schemas.TwoFactorRecoveryCodesRequest,
        db: Session = Depends(get_db),
        current_user: models.User = Depends(get_current_active_user)
    ):
        """Regenerate one-time backup recovery codes for the current user."""
        check_password_change_required(current_user)
        if not current_user.two_factor_enabled:
            raise HTTPException(status_code=400, detail="Two-factor authentication is not enabled")
        if not verify_password(payload.current_password, current_user.hashed_password):
            logger.warning("Two-factor recovery code regeneration rejected due to invalid password for user_id=%s", current_user.id)
            raise HTTPException(status_code=400, detail="Incorrect password")

        from ..services.totp_service import decrypt_totp_secret, encrypt_recovery_code_hashes, encrypt_totp_secret, generate_recovery_codes, verify_and_consume_recovery_code, verify_totp

        secret, was_encrypted = decrypt_totp_secret(current_user.two_factor_secret)
        if secret and not was_encrypted:
            current_user.two_factor_secret = encrypt_totp_secret(secret)
            db.commit()

        recovery_code_used = False
        if not verify_totp(secret, payload.code):
            recovery_code_used, _ = verify_and_consume_recovery_code(current_user.two_factor_recovery_codes, payload.code)
        if not verify_totp(secret, payload.code) and not recovery_code_used:
            logger.warning("Two-factor recovery code regeneration rejected due to invalid code for user_id=%s", current_user.id)
            raise HTTPException(status_code=400, detail="Invalid two-factor authentication code")

        recovery_codes = generate_recovery_codes()
        current_user.two_factor_recovery_codes = encrypt_recovery_code_hashes(recovery_codes)
        db.commit()
        logger.info("Two-factor recovery codes regenerated for user_id=%s", current_user.id)
        return {"recovery_codes": recovery_codes}

    @app.post("/users/me/avatar")
    async def upload_avatar(
        file: UploadFile,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Upload profile avatar"""
        # Check if user needs to change password
        check_password_change_required(current_user)
        # Validate file type
        validate_file_type(file, ['image/jpeg', 'image/png', 'image/gif', 'image/webp'], "Avatar")
        
        # Validate file size
        content = await validate_file_size(file, MAX_AVATAR_SIZE, "Avatar")
        
        # In a real implementation, you would save to cloud storage or file system
        # For now, we'll store as base64 in the database
        import base64
        avatar_data = f"data:{file.content_type};base64,{base64.b64encode(content).decode()}"
        
        current_user.avatar_url = avatar_data
        db.commit()
        db.refresh(current_user)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.USER.value,
                entity_id=current_user.id,
                project_id=None,
                description=f"Avatar uploaded for user: {current_user.username or current_user.email}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for avatar upload: {e}")
        
        return {"avatar_url": current_user.avatar_url}

    @app.delete("/users/me")
    async def delete_account(
        confirmation: dict,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Delete user account"""
        password = confirmation.get('password')
        confirm_text = confirmation.get('confirm_text')
        
        if not password:
            raise HTTPException(status_code=400, detail="Password is required")
        
        if not confirm_text:
            raise HTTPException(status_code=400, detail="Confirmation text is required")
        
        if confirm_text != "DELETE MY ACCOUNT":
            raise HTTPException(status_code=400, detail="Confirmation text must be 'DELETE MY ACCOUNT'")
        
        # Verify password
        if not verify_password(password, current_user.hashed_password):
            raise HTTPException(status_code=400, detail="Incorrect password")
        
        # Store data for audit trail before deletion
        user_id_val = current_user.id
        user_identifier = current_user.username or current_user.email
        
        # Delete user (this will cascade delete related data)
        crud.delete_user(db, current_user.id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.USER.value,
                entity_id=user_id_val,
                project_id=None,
                description=f"User account deleted: {user_identifier}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for account deletion: {e}")
        
        return {"message": "Account deleted successfully"}

    @app.get("/users/me/statistics")
    async def get_user_statistics(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get user statistics"""
        from ..models import TestCase, TestResult, TestRun, Defect
        
        # Count test cases created by user
        test_cases_count = db.query(TestCase).filter(TestCase.created_by == current_user.id).count()
        
        # Count test runs executed by user (as executor)
        test_runs_count = db.query(TestResult).filter(TestResult.executed_by == current_user.id).count()
        
        # Count defects reported by user
        defects_count = db.query(Defect).filter(Defect.reported_by == current_user.id).count()
        
        # Calculate success rate (passed test results / total test results)
        total_results = db.query(TestResult).filter(TestResult.executed_by == current_user.id).count()
        passed_results = db.query(TestResult).filter(
            TestResult.executed_by == current_user.id,
            TestResult.status == "pass"
        ).count()
        success_rate = (passed_results / total_results * 100) if total_results > 0 else 0
        
        return {
            "test_cases_created": test_cases_count,
            "test_runs_executed": test_runs_count,
            "defects_reported": defects_count,
            "success_rate": round(success_rate, 1)
        }

    @app.put("/users/me")
    def update_current_user(
        user_update: schemas.UserUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Update current user's profile"""
        # Check if user needs to change password
        check_password_change_required(current_user)
        # Create a regular UserUpdate object, excluding fields that shouldn't be updated via profile
        update_data = user_update.model_dump(exclude_unset=True)

        # Remove sensitive fields that shouldn't be updated via profile endpoint
        update_data.pop('role', None)
        update_data.pop('is_active', None)
        update_data.pop('password', None)

        # Check username uniqueness if username is being updated
        if 'username' in update_data and update_data['username'] != current_user.username:
            existing_user = crud.get_user_by_username(db, username=update_data['username'])
            if existing_user and existing_user.id != current_user.id:
                raise HTTPException(status_code=400, detail="Username already taken")

        # Check email uniqueness if email is being updated
        if 'email' in update_data and update_data['email'] != current_user.email:
            existing_user = crud.get_user_by_email(db, email=update_data['email'])
            if existing_user and existing_user.id != current_user.id:
                raise HTTPException(status_code=400, detail="Email already taken")

        # Sanitize all data to prevent XSS attacks (including nested structures and JSON)
        # Website field is validated for URL format but not escaped
        update_data = sanitize_data(update_data, skip_fields={'website'})

        db_user = crud.update_user(db=db, user_id=current_user.id, user=schemas.UserUpdate(**update_data))
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.USER.value,
                entity_id=current_user.id,
                project_id=None,
                description=f"User profile updated: {current_user.username or current_user.email}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for profile update: {e}")
        
        return db_user

    @app.post("/users", response_model=schemas.User)
    def create_user(user: schemas.UserCreate, db: Session = Depends(get_db), current_user: schemas.User = Depends(get_current_active_user)):
        # Check if user needs to change password
        check_password_change_required(current_user)
        require_manage_users(current_user)
        
        db_user = crud.get_user_by_username(db, username=user.username)
        if db_user:
            raise HTTPException(status_code=400, detail="Username already registered")
        db_user = crud.get_user_by_email(db, email=user.email)
        if db_user:
            raise HTTPException(status_code=400, detail="Email already registered")
        new_user = crud.create_user(db=db, user=user)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.USER.value,
                entity_id=new_user.id,
                project_id=None,
                description=f"User created: {new_user.username or new_user.email}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for user creation: {e}")
        
        # Initialize onboarding checklist for new user
        try:
            crud.initialize_onboarding_checklist(db, new_user.id)
        except Exception as e:
            print(f"Failed to initialize onboarding checklist: {e}")
        
        return new_user

    @app.get("/users", response_model=List[schemas.User])
    def read_users(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: schemas.User = Depends(get_current_active_user)):
        # Check if user needs to change password
        check_password_change_required(current_user)
        require_manage_users(current_user)
        
        users = crud.get_users(db, skip=skip, limit=limit)
        # Convert role to lowercase for consistent API responses without changing persisted data here.
        for user in users:
            user.role = rbac.role_value(user.role)
        return users

    @app.get("/users/{user_id}", response_model=schemas.User)
    def read_user(user_id: int, db: Session = Depends(get_db), current_user: schemas.User = Depends(get_current_active_user)):
        # Users can only view their own profile unless they're superuser or admin
        if current_user.id != user_id and not rbac.has_permission(current_user, "manage_users"):
            raise HTTPException(status_code=403, detail="Not authorized to view this user")
        
        db_user = crud.get_user(db, user_id=user_id)
        if db_user is None:
            raise HTTPException(status_code=404, detail="User not found")
        return db_user

    @app.put("/users/{user_id}", response_model=schemas.User)
    def update_user(
        user_id: int,
        user: schemas.UserUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        can_manage_users = rbac.has_permission(current_user, "manage_users")
        if current_user.id != user_id and not can_manage_users:
            raise HTTPException(status_code=403, detail="Not authorized to update this user")

        if current_user.id == user_id and not can_manage_users:
            update_data = user.model_dump(exclude_unset=True)
            for restricted_field in ("role", "is_active", "force_password_change"):
                update_data.pop(restricted_field, None)
            user = schemas.UserUpdate(**update_data)
        
        # Prevent users from changing their own role (both upgrade and downgrade)
        if current_user.id == user_id and user.role is not None:
            from ..models import Role
            # Get current role
            if isinstance(current_user.role, str):
                current_role = current_user.role.lower()
            else:
                current_role = current_user.role.value.lower()
            
            # Get new role
            if isinstance(user.role, str):
                new_role = user.role.lower()
            else:
                new_role = user.role.value.lower()
            
            # Prevent no-change updates
            if current_role == new_role:
                raise HTTPException(
                    status_code=400,
                    detail="Role is already set to this value. No change needed."
                )
            
            # Define role hierarchy
            role_hierarchy = {
                Role.ADMIN.value: 4,
                Role.MANAGER.value: 3,
                Role.TESTER.value: 2,
                Role.VIEWER.value: 1
            }
            
            current_level = role_hierarchy.get(current_role, 0)
            new_level = role_hierarchy.get(new_role, 0)
            
            # Prevent both upgrade and downgrade
            if new_level != current_level:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot change your own role. Ask another admin to make this change."
                )
        
        db_user = crud.update_user(db=db, user_id=user_id, user=user)
        if db_user is None:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.USER.value,
                entity_id=db_user.id,
                project_id=None,
                description=f"User updated: {db_user.username or db_user.email}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for user update: {e}")
        
        return db_user

    @app.post("/users/{user_id}/2fa/reset", response_model=schemas.AdminTwoFactorResetResponse)
    def reset_user_two_factor(
        user_id: int,
        db: Session = Depends(get_db),
        current_user: models.User = Depends(get_current_active_user)
    ):
        """Admin recovery flow for users locked out of two-factor authentication."""
        check_password_change_required(current_user)
        require_manage_users(current_user)
        if current_user.id == user_id:
            raise HTTPException(status_code=400, detail="Admins cannot reset their own two-factor authentication")

        db_user = crud.get_user(db, user_id=user_id)
        if db_user is None:
            raise HTTPException(status_code=404, detail="User not found")

        db_user.two_factor_enabled = False
        db_user.two_factor_secret = None
        db_user.two_factor_recovery_codes = None
        _revoke_user_sessions(db, db_user)
        logger.info("Two-factor authentication reset by admin user_id=%s for user_id=%s", current_user.id, db_user.id)

        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_service.create_audit_trail(AuditTrailCreate(
                user_id=current_user.id,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.USER.value,
                entity_id=db_user.id,
                project_id=None,
                description=f"Two-factor authentication reset for user: {db_user.username or db_user.email}",
            ))
        except Exception as e:
            logger.warning("Failed to create audit trail for two-factor reset: %s", e)

        return {"enabled": False, "user_id": db_user.id}

    @app.delete("/users/{user_id}")
    def delete_user(
        user_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Check if user needs to change password
        check_password_change_required(current_user)
        
        require_manage_users(current_user)
        
        if current_user.id == user_id:
            raise HTTPException(status_code=400, detail="Cannot delete yourself")
        
        # Store data for audit trail before deletion
        db_user = crud.get_user(db, user_id=user_id)
        if db_user is None:
            raise HTTPException(status_code=404, detail="User not found")
        
        user_id_val = db_user.id
        user_identifier = db_user.username or db_user.email
        
        db_user = crud.delete_user(db, user_id=user_id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.USER.value,
                entity_id=user_id_val,
                project_id=None,
                description=f"User deleted: {user_identifier}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for user deletion: {e}")
        
        return {"message": "User deleted successfully"}

    # User Invitation Endpoints
    @app.post("/invitations", response_model=schemas.UserInvitationPublic)
    def create_invitation(
        invitation: schemas.UserInvitationCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        require_manage_users(current_user)

        # Check if user already exists
        existing_user = crud.get_user_by_email(db, email=invitation.email)
        if existing_user:
            raise HTTPException(status_code=400, detail="User with this email already exists")
        
        # Create invitation
        invitation_data = invitation.model_dump()
        db_invitation = crud.create_user_invitation(db, invitation_data, current_user.id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.INVITATION.value,
                entity_id=db_invitation.id,
                project_id=None,
                description=f"Invitation created for email: {invitation.email}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for invitation creation: {e}")
        
        return db_invitation

    @app.get("/invitations", response_model=List[schemas.UserInvitationPublic])
    def read_invitations(
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        require_manage_users(current_user)
        
        invitations = crud.get_user_invitations(db, skip=skip, limit=limit)
        return invitations

    @app.get("/invitations/{token}")
    def get_invitation_by_token(token: str, db: Session = Depends(get_db)):
        invitation = crud.get_user_invitation_by_token(db, token=token)
        if invitation is None:
            raise HTTPException(status_code=404, detail="Invitation not found or already used")
        
        # Check if expired
        if invitation.expires_at < datetime.now():
            raise HTTPException(status_code=400, detail="Invitation has expired")
        
        return {
            "email": invitation.email,
            "role": invitation.role,
            "expires_at": invitation.expires_at
        }

    @app.post("/invitations/{token}/accept")
    def accept_invitation(
        token: str,
        accept_data: schemas.UserInvitationAccept,
        db: Session = Depends(get_db)
    ):
        # Verify token matches
        if accept_data.token != token:
            raise HTTPException(status_code=400, detail="Invalid token")
        
        # Get invitation
        invitation = crud.get_user_invitation_by_token(db, token=token)
        if invitation is None:
            raise HTTPException(status_code=404, detail="Invitation not found or already used")
        
        # Check if expired
        if invitation.expires_at < datetime.now():
            raise HTTPException(status_code=400, detail="Invitation has expired")
        
        # Check if user already exists
        existing_user = crud.get_user_by_email(db, email=invitation.email)
        if existing_user:
            raise HTTPException(status_code=400, detail="User already exists")
        
        # Create user
        user_data = schemas.UserCreate(
            username=accept_data.username,
            email=invitation.email,
            password=accept_data.password,
            full_name=accept_data.full_name,
            role=rbac.role_value(invitation.role),
            is_active=True
        )
        new_user = crud.create_user(db, user=user_data)
        
        # Assign to projects
        if invitation.project_ids:
            project_ids = [int(pid) for pid in invitation.project_ids.split(',') if pid]
            for project_id in project_ids:
                assignment = crud_rbac.create_project_assignment(
                    db,
                    crud_rbac.ProjectAssignmentCreate(
                        user_id=new_user.id,
                        project_id=project_id,
                        role=rbac.role_value(invitation.role),
                )
            )
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=new_user.id,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.USER.value,
                entity_id=new_user.id,
                project_id=None,
                description=f"User created via invitation: {new_user.username or new_user.email}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for invitation acceptance: {e}")
        
        # Mark invitation as used
        crud.delete_user_invitation(db, invitation_id=invitation.id)
        return {"message": "Invitation accepted successfully", "user_id": new_user.id}

    @app.delete("/invitations/{invitation_id}")
    def delete_invitation(
        invitation_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        require_manage_users(current_user)
        
        # Store data for audit trail before deletion
        db_invitation = crud.get_user_invitation(db, invitation_id=invitation_id)
        if db_invitation is None:
            raise HTTPException(status_code=404, detail="Invitation not found")
        
        invitation_email = db_invitation.email
        
        db_invitation = crud.delete_user_invitation(db, invitation_id=invitation_id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.INVITATION.value,
                entity_id=invitation_id,
                project_id=None,
                description=f"Invitation deleted for email: {invitation_email}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for invitation deletion: {e}")
        
        return {"message": "Invitation deleted successfully"}

    @app.put("/users/me/notification-preferences")
    def update_notification_preferences(
        request: schemas.NotificationPreferencesUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Update user notification preferences"""
        from datetime import datetime, timedelta
        from ..models import User
        
        user = db.query(User).filter(User.id == current_user.id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        if request.do_not_disturb is not None:
            user.do_not_disturb = request.do_not_disturb
            # When DND is disabled, also clear the mute time
            if not request.do_not_disturb:
                user.notifications_muted_until = None
        
        if request.notification_sound_enabled is not None:
            user.notification_sound_enabled = request.notification_sound_enabled
        
        if request.mute_duration_hours is not None:
            if request.mute_duration_hours < 1:
                raise HTTPException(status_code=400, detail="mute_duration_hours must be at least 1")
            if request.mute_duration_hours > 168:  # Max 1 week
                raise HTTPException(status_code=400, detail="mute_duration_hours cannot exceed 168 hours (1 week)")
            user.notifications_muted_until = datetime.now() + timedelta(hours=request.mute_duration_hours)
            # When setting mute duration, also enable DND
            user.do_not_disturb = True
        
        db.commit()
        db.refresh(user)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.USER.value,
                entity_id=current_user.id,
                project_id=None,
                description=f"Notification preferences updated for user: {current_user.username or current_user.email}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for notification preferences update: {e}")
        
        return {
            "do_not_disturb": user.do_not_disturb,
            "notification_sound_enabled": user.notification_sound_enabled,
            "notifications_muted_until": user.notifications_muted_until
        }

    @app.get("/users/me/notification-preferences")
    def get_notification_preferences(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get user notification preferences"""
        from ..models import User
        
        user = db.query(User).filter(User.id == current_user.id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        return {
            "do_not_disturb": user.do_not_disturb,
            "notification_sound_enabled": user.notification_sound_enabled,
            "notifications_muted_until": user.notifications_muted_until
        }

    @app.get("/users/me/onboarding-checklist")
    def get_onboarding_checklist(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get onboarding checklist for current user"""
        try:
            checklist = crud.get_onboarding_checklist(db, current_user.id)
            return [
                {
                    "id": item.id,
                    "task_key": item.task_key,
                    "task_name": item.task_name,
                    "description": item.description,
                    "is_completed": item.is_completed,
                    "completed_at": item.completed_at.isoformat() if item.completed_at else None
                }
                for item in checklist
            ]
        except Exception as e:
            # If checklist doesn't exist or table missing, return empty array
            print(f"Failed to get onboarding checklist: {e}")
            return []

    @app.put("/users/me/onboarding-checklist/{task_key}")
    def update_onboarding_task(
        task_key: str,
        task_data: dict,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Update onboarding task completion status"""
        try:
            is_completed = task_data.get('is_completed', False)
            task = crud.update_onboarding_task(db, current_user.id, task_key, is_completed)
            
            if not task:
                raise HTTPException(status_code=404, detail="Task not found")
            
            return {
                "id": task.id,
                "task_key": task.task_key,
                "task_name": task.task_name,
                "description": task.description,
                "is_completed": task.is_completed,
                "completed_at": task.completed_at.isoformat() if task.completed_at else None
            }
        except HTTPException:
            raise
        except Exception as e:
            print(f"Failed to update onboarding task: {e}")
            raise HTTPException(status_code=500, detail="Failed to update onboarding task")
