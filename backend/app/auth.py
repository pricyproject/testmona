from datetime import datetime, timedelta
from typing import Optional
import hashlib
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import func
from sqlalchemy.orm import Session
from .database import get_db
from .models import User, Role, RefreshToken
from .schemas import TokenData
from .config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token", auto_error=False)


def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password):
    return pwd_context.hash(password)


MIN_PASSWORD_LENGTH = 8


def validate_password_strength(password: str) -> None:
    """Enforce a baseline password policy. Raises ValueError when too weak.

    Modern (NIST-aligned) baseline: favor length, reject the obviously weak.
    Callers translate the ValueError into an HTTP 400.
    """
    if password is None or len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    if password.isdigit() or password.isalpha():
        raise ValueError("Password must include both letters and numbers")
    if password.lower() in {"password", "12345678", "password1", "qwerty123"}:
        raise ValueError("Password is too common; choose a stronger one")


def get_user(db: Session, username: str):
    return db.query(User).filter(User.username == username.strip()).first()


def get_user_by_email(db: Session, email: str):
    return db.query(User).filter(func.lower(User.email) == email.strip().lower()).first()


def authenticate_user(db: Session, username_or_email: str, password: str):
    identifier = username_or_email.strip()
    if not identifier:
        return False

    # First try to find user by username
    user = get_user(db, identifier)
    
    # If not found by username, try by email
    if not user:
        user = get_user_by_email(db, identifier)
    
    if not user:
        return False
    if not verify_password(password, user.hashed_password):
        return False
    return user


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)
    return encoded_jwt


def _token_session_is_current(payload: dict, user: User) -> bool:
    token_session_version = int(payload.get("sv") or 0)
    user_session_version = int(getattr(user, "session_version", 0) or 0)
    return token_session_version == user_session_version


def create_refresh_token(data: dict, expires_delta: Optional[timedelta] = None, db: Session = None, user_id: int = None, device_info: str = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(days=settings.refresh_token_expire_days)
    to_encode.update({"exp": expire, "type": "refresh"})
    
    # Generate refresh token
    refresh_token = jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)
    
    # Store in database if db and user_id provided
    if db and user_id:
        # Hash the token for storage
        token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
        
        # Create refresh token record
        db_refresh_token = RefreshToken(
            token=refresh_token,
            token_hash=token_hash,
            user_id=user_id,
            expires_at=expire,
            device_info=device_info
        )
        db.add(db_refresh_token)
        db.commit()
    
    return refresh_token


async def get_current_user(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    token = token or request.cookies.get("access_token")
    if not token:
        raise credentials_exception

    # API tokens (``tmona_*``) are accepted alongside JWTs so CI/CD and other
    # scripted callers can authenticate without spinning up a login flow.
    from .services.api_token_service import looks_like_api_token, get_user_for_token
    if looks_like_api_token(token):
        api_user = get_user_for_token(db, token)
        if api_user is None:
            raise credentials_exception
        return api_user

    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = get_user(db, username=username)
    if user is None:
        raise credentials_exception
    if not _token_session_is_current(payload, user):
        raise credentials_exception
    return user


async def get_current_user_check_password_change(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """Dependency that checks if user needs to change password and raises exception if true"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    token = token or request.cookies.get("access_token")
    if not token:
        raise credentials_exception

    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = get_user(db, username=username)
    if user is None:
        raise credentials_exception
    if not _token_session_is_current(payload, user):
        raise credentials_exception
    
    # Check if user needs to change password
    if user.force_password_change:
        raise HTTPException(
            status_code=403,
            detail="Password change required. Please change your password before accessing this resource."
        )
    
    return user


def check_password_change_required(user):
    """Helper function to check if user needs password change"""
    if user.force_password_change:
        raise HTTPException(
            status_code=403,
            detail="Password change required. Please change your password before accessing this resource."
        )


def verify_refresh_token(refresh_token: str, db: Session) -> Optional[User]:
    """Verify refresh token and return user if valid"""
    try:
        # Decode JWT
        payload = jwt.decode(refresh_token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        # Token signature verification failed (e.g., secret key changed)
        return None
    
    username: str = payload.get("sub")
    token_type: str = payload.get("type")
    
    if username is None or token_type != "refresh":
        return None
    
    # Check token in database
    token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
    db_token = db.query(RefreshToken).filter(
        RefreshToken.token_hash == token_hash,
        RefreshToken.is_revoked == False,
        RefreshToken.expires_at > datetime.utcnow()
    ).first()
    
    if not db_token:
        return None
    
    # Update last used timestamp
    db_token.last_used_at = datetime.utcnow()
    db.commit()
    
    # Get user
    user = get_user(db, username)
    if user is None or not _token_session_is_current(payload, user):
        return None
    return user


def revoke_refresh_token(refresh_token: str, db: Session) -> bool:
    """Revoke a refresh token"""
    token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
    db_token = db.query(RefreshToken).filter(
        RefreshToken.token_hash == token_hash
    ).first()
    
    if db_token:
        db_token.is_revoked = True
        db_token.revoked_at = datetime.utcnow()
        db.commit()
        return True
    return False


def revoke_all_user_refresh_tokens(user_id: int, db: Session) -> bool:
    """Revoke all refresh tokens for a user"""
    db.query(RefreshToken).filter(
        RefreshToken.user_id == user_id,
        RefreshToken.is_revoked == False
    ).update({
        RefreshToken.is_revoked: True,
        RefreshToken.revoked_at: datetime.utcnow()
    })
    db.commit()
    return True


def cleanup_expired_refresh_tokens(db: Session) -> int:
    """Clean up expired and revoked refresh tokens"""
    # Delete expired tokens
    expired_count = db.query(RefreshToken).filter(
        RefreshToken.expires_at < datetime.utcnow()
    ).delete()
    
    # Delete revoked tokens older than 30 days
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    revoked_count = db.query(RefreshToken).filter(
        RefreshToken.is_revoked == True,
        RefreshToken.revoked_at < thirty_days_ago
    ).delete()
    
    db.commit()
    return expired_count + revoked_count


async def get_current_active_user(current_user: User = Depends(get_current_user)):
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user
