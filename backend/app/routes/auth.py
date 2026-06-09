"""
Authentication routes for login, registration, and token management.
"""

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session
from datetime import timedelta
import logging

from .. import crud, schemas, auth
from ..database import get_db
from ..config import settings
from ..models import User, Role, EntityType


logger = logging.getLogger(__name__)


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    response.set_cookie(
        key="access_token",
        value=access_token,
        max_age=settings.access_token_expire_minutes * 60,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite=settings.auth_cookie_samesite,
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite=settings.auth_cookie_samesite,
        path="/",
    )


def _clear_auth_cookies(response: Response) -> None:
    for cookie_name in ("access_token", "refresh_token"):
        response.delete_cookie(
            key=cookie_name,
            secure=settings.auth_cookie_secure,
            samesite=settings.auth_cookie_samesite,
            path="/",
        )


def _disable_public_signup(db, actor_user) -> None:
    """Close public registration after first-run setup (idempotent upsert)."""
    from ..models import SystemSettings as SystemSettingsModel
    try:
        setting = db.query(SystemSettingsModel).filter(
            SystemSettingsModel.key == 'signup_enabled'
        ).with_for_update().first()
        if setting is None:
            setting = SystemSettingsModel(
                key='signup_enabled',
                value='false',
                description='Enable/disable public user registration',
            )
            db.add(setting)
        else:
            setting.value = 'false'
        db.commit()
        db.refresh(setting)
        print("✅ Public signup disabled after first-run setup")
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            audit_service = get_audit_service(db)
            audit_service.create_audit_trail(AuditTrailCreate(
                user_id=actor_user.id,
                action="update",
                entity_type=EntityType.SYSTEM_SETTING,
                entity_id=setting.id,
                description=f"Public signup disabled after first-run setup (admin: {actor_user.username})",
            ))
        except Exception as audit_error:
            print(f"Failed to create audit trail for signup change: {audit_error}")
    except Exception as e:
        print(f"Failed to disable signup: {e}")
        db.rollback()


def register_auth_routes(app):
    """Register authentication routes with the FastAPI app."""

    @app.post("/system/setup", response_model=schemas.User)
    def complete_first_run_setup(payload: schemas.FirstAdminSetup, db: Session = Depends(get_db)):
        """Create the first administrator on a brand-new instance.

        Token-gated and usable only while no account exists. This is the ONLY
        way to create the initial admin; `/register` cannot. Two independent
        gates close the first-run abuse window: the no-accounts check and the
        server-issued setup token.
        """
        from ..setup_security import needs_setup, verify_setup_token, clear_setup_token

        # Gate 1: permanently closed once any account exists.
        if not needs_setup(db):
            raise HTTPException(status_code=403, detail="Setup has already been completed.")
        # Gate 2: caller must present the server-issued token (constant-time
        # compare inside verify; generic message avoids an oracle).
        if not verify_setup_token(payload.setup_token):
            raise HTTPException(status_code=403, detail="Invalid or missing setup token.")

        try:
            auth.validate_password_strength(payload.password)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        if crud.get_user_by_username(db, username=payload.username):
            raise HTTPException(status_code=400, detail="Username already registered")
        if crud.get_user_by_email(db, email=payload.email):
            raise HTTPException(status_code=400, detail="Email already registered")

        # Privileges are fixed server-side — never accepted from the request.
        admin = schemas.UserCreate(
            username=payload.username,
            email=payload.email,
            full_name=payload.full_name,
            password=payload.password,
            role=Role.ADMIN,
            is_active=True,
            force_password_change=False,
        )
        new_user = crud.create_user(db=db, user=admin)
        new_user.is_superuser = True
        db.commit()
        db.refresh(new_user)

        _disable_public_signup(db, new_user)
        clear_setup_token()  # single-use: invalidate the token immediately
        return new_user

    @app.post("/register", response_model=schemas.User)
    def register_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
        # The first account can only be created through the token-gated
        # /system/setup endpoint — never here. This closes the "claim admin on
        # an open install" race.
        if db.query(User).count() == 0:
            raise HTTPException(status_code=403, detail="Complete first-run setup before registering accounts.")

        # Default-deny: public registration is off unless an admin explicitly
        # enabled it (a missing setting counts as disabled).
        signup_enabled_setting = crud.get_system_setting(db, "signup_enabled")
        if not signup_enabled_setting or signup_enabled_setting.value != "true":
            raise HTTPException(status_code=403, detail="Public registration is disabled. Please contact an administrator.")

        try:
            auth.validate_password_strength(user.password)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        if crud.get_user_by_username(db, username=user.username):
            raise HTTPException(status_code=400, detail="Username already registered")
        if crud.get_user_by_email(db, email=user.email):
            raise HTTPException(status_code=400, detail="Email already registered")

        # Self-service registrants are always plain testers — the role cannot be
        # escalated from the request body.
        user = user.model_copy(update={"role": Role.TESTER, "force_password_change": False})
        return crud.create_user(db=db, user=user)

    @app.post("/token", response_model=schemas.Token)
    async def login_for_access_token_json(
        login_data: schemas.LoginRequest,
        response: Response,
        db: Session = Depends(get_db),
    ):
        user = auth.authenticate_user(db, login_data.username_or_email, login_data.password)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username/email or password",
                headers={"WWW-Authenticate": "Bearer"},
            )

        if user.two_factor_enabled:
            from ..services.totp_service import decrypt_totp_secret, encrypt_totp_secret, verify_and_consume_recovery_code, verify_totp

            if not login_data.two_factor_code:
                return {
                    "access_token": None,
                    "refresh_token": None,
                    "token_type": "bearer",
                    "requires_2fa": True,
                    "force_password_change": user.force_password_change,
                }

            secret, was_encrypted = decrypt_totp_secret(user.two_factor_secret)
            if secret and not was_encrypted:
                user.two_factor_secret = encrypt_totp_secret(secret)
                db.commit()

            recovery_code_used = False
            if not verify_totp(secret, login_data.two_factor_code):
                recovery_code_used, updated_recovery_codes = verify_and_consume_recovery_code(
                    user.two_factor_recovery_codes,
                    login_data.two_factor_code,
                )
                if recovery_code_used:
                    user.two_factor_recovery_codes = updated_recovery_codes
                    db.commit()

            if not verify_totp(secret, login_data.two_factor_code) and not recovery_code_used:
                logger.warning("Login rejected due to invalid two-factor code for user_id=%s", user.id)
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid two-factor authentication code",
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
            data={"sub": user.username, "sv": user.session_version}, expires_delta=access_token_expires
        )
        refresh_token = auth.create_refresh_token(
            data={"sub": user.username, "sv": user.session_version},
            expires_delta=refresh_token_expires,
            db=db,
            user_id=user.id,
            device_info="web_client"  # You can extract this from request headers
        )
        _set_auth_cookies(response, access_token, refresh_token)
        return {
            "access_token": access_token, 
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "requires_2fa": False,
            "force_password_change": user.force_password_change,
        }

    @app.post("/refresh", response_model=schemas.Token)
    async def refresh_token(
        response: Response,
        request: Request,
        refresh_data: dict = None,
        db: Session = Depends(get_db),
    ):
        refresh_token = (refresh_data or {}).get('refresh_token') or request.cookies.get("refresh_token")
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
            data={"sub": user.username, "sv": user.session_version}, expires_delta=access_token_expires
        )
        
        # Create new refresh token (rotation)
        refresh_token_expires = timedelta(days=settings.refresh_token_expire_days)
        new_refresh_token = auth.create_refresh_token(
            data={"sub": user.username, "sv": user.session_version},
            expires_delta=refresh_token_expires,
            db=db,
            user_id=user.id,
            device_info="refresh_rotation"
        )
        _set_auth_cookies(response, access_token, new_refresh_token)
        
        return {
            "access_token": access_token,
            "refresh_token": new_refresh_token,  # Return new refresh token
            "token_type": "bearer",
            "requires_2fa": False,
            "force_password_change": user.force_password_change,
        }

    @app.post("/logout")
    async def logout(
        response: Response,
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
        _clear_auth_cookies(response)
        
        return {"message": "Successfully logged out"}

    @app.get("/users/me", response_model=schemas.User)
    async def read_users_me(current_user: schemas.User = Depends(auth.get_current_active_user)):
        return current_user
