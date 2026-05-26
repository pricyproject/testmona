"""
Authentication routes for login, registration, and token management.
"""

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import timedelta

from .. import crud, schemas, auth
from ..database import get_db
from ..config import settings
from ..models import User, Role, EntityType


def register_auth_routes(app):
    """Register authentication routes with the FastAPI app."""
    
    @app.post("/register", response_model=schemas.User)
    def register_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
        # Check if signup is enabled (default to enabled if setting doesn't exist)
        signup_enabled_setting = crud.get_system_setting(db, "signup_enabled")
        if signup_enabled_setting and signup_enabled_setting.value == "false":
            raise HTTPException(status_code=403, detail="Public registration is disabled. Please contact an administrator.")
        
        db_user = crud.get_user_by_username(db, username=user.username)
        if db_user:
            raise HTTPException(status_code=400, detail="Username already registered")
        db_user = crud.get_user_by_email(db, email=user.email)
        if db_user:
            raise HTTPException(status_code=400, detail="Email already registered")
        
        is_first_user = db.query(User).count() == 0
        user = user.model_copy(update={"role": Role.ADMIN if is_first_user else Role.TESTER})
        new_user = crud.create_user(db=db, user=user)
        if is_first_user:
            new_user.is_superuser = True
            db.commit()
            db.refresh(new_user)
        
        # Auto-disable signup after first user creation (with race condition protection)
        from ..models import SystemSettings as SystemSettingsModel
        try:
            # Use row-level locking to prevent race conditions
            existing_setting = db.query(SystemSettingsModel).filter(
                SystemSettingsModel.key == 'signup_enabled'
            ).with_for_update().first()
            
            if existing_setting and existing_setting.value == "true":
                # Check user count atomically
                user_count = db.query(User).count()
                if user_count == 1:  # Only disable if this is truly the first user
                    existing_setting.value = "false"
                    db.commit()
                    print("✅ Signup automatically disabled after first user creation")
                    
                    # Create audit trail for signup_enabled change
                    try:
                        from ..services.audit_service import get_audit_service
                        from ..schemas_audit import AuditTrailCreate
                        audit_service = get_audit_service(db)
                        audit_data = AuditTrailCreate(
                            user_id=new_user.id,
                            action="update",
                            entity_type=EntityType.SYSTEM_SETTING,
                            entity_id=existing_setting.id,
                            description=f"Signup automatically disabled after first user creation (user: {new_user.username})",
                        )
                        audit_service.create_audit_trail(audit_data)
                    except Exception as audit_error:
                        print(f"Failed to create audit trail for signup change: {audit_error}")
        except Exception as e:
            print(f"Failed to auto-disable signup: {e}")
            db.rollback()
        
        return new_user

    @app.post("/token", response_model=schemas.Token)
    async def login_for_access_token_json(login_data: schemas.LoginRequest, db: Session = Depends(get_db)):
        user = auth.authenticate_user(db, login_data.username_or_email, login_data.password)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username/email or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        # Create audit trail for successful login
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=user.id,
                action="login",
                entity_type="user",
                entity_id=user.id,
                description=f"User {user.username} logged in via web interface",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            # Log error but don't fail the login
            print(f"Failed to create audit trail for login: {e}")
        
        access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
        refresh_token_expires = timedelta(days=settings.refresh_token_expire_days)
        access_token = auth.create_access_token(
            data={"sub": user.username}, expires_delta=access_token_expires
        )
        refresh_token = auth.create_refresh_token(
            data={"sub": user.username}, 
            expires_delta=refresh_token_expires,
            db=db,
            user_id=user.id,
            device_info="web_client"  # You can extract this from request headers
        )
        return {
            "access_token": access_token, 
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "force_password_change": user.force_password_change
        }

    @app.post("/refresh", response_model=schemas.Token)
    async def refresh_token(refresh_data: dict, db: Session = Depends(get_db)):
        refresh_token = refresh_data.get('refresh_token')
        if not refresh_token:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="refresh_token field is required",
            )
        
        # Verify the refresh token using our new function
        user = auth.verify_refresh_token(refresh_token, db)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired refresh token",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        # Create new access token
        access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
        access_token = auth.create_access_token(
            data={"sub": user.username}, expires_delta=access_token_expires
        )
        
        # Create new refresh token (rotation)
        refresh_token_expires = timedelta(days=settings.refresh_token_expire_days)
        new_refresh_token = auth.create_refresh_token(
            data={"sub": user.username}, 
            expires_delta=refresh_token_expires,
            db=db,
            user_id=user.id,
            device_info="refresh_rotation"
        )
        
        return {
            "access_token": access_token,
            "refresh_token": new_refresh_token,  # Return new refresh token
            "token_type": "bearer",
            "force_password_change": user.force_password_change
        }

    @app.post("/logout")
    async def logout(
        logout_data: dict = None,
        current_user: schemas.User = Depends(auth.get_current_active_user),
        db: Session = Depends(get_db)
    ):
        """Logout endpoint that invalidates refresh tokens"""
        # If specific refresh token provided, revoke only that one
        if logout_data and logout_data.get('refresh_token'):
            refresh_token = logout_data.get('refresh_token')
            auth.revoke_refresh_token(refresh_token, db)
        else:
            # Revoke all refresh tokens for the user
            auth.revoke_all_user_refresh_tokens(current_user.id, db)
        
        return {"message": "Successfully logged out"}

    @app.get("/users/me", response_model=schemas.User)
    async def read_users_me(current_user: schemas.User = Depends(auth.get_current_active_user)):
        return current_user
