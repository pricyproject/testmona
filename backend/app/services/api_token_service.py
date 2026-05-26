"""API token issuance and verification.

Tokens are formatted as ``tmona_<22-char-random>``. We never store the raw
token — only a sha256 of it — so a database compromise doesn't leak usable
credentials. The plaintext is returned exactly once on creation.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timezone
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from ..models import ApiToken, User


TOKEN_PREFIX = "tmona_"
_SECRET_BYTES = 24  # 24 bytes => 32-char base64; plus 6-char prefix


def generate_token() -> Tuple[str, str, str]:
    """Return ``(raw_token, prefix, token_hash)``.

    ``prefix`` is what we surface in management UIs to help a user identify
    the token (the first chars of the raw token, kept stable across sessions).
    """
    raw_secret = secrets.token_urlsafe(_SECRET_BYTES)
    raw_token = f"{TOKEN_PREFIX}{raw_secret}"
    prefix = raw_token[: len(TOKEN_PREFIX) + 4]  # e.g. "tmona_xKf3"
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    return raw_token, prefix, token_hash


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def looks_like_api_token(value: Optional[str]) -> bool:
    return bool(value and value.startswith(TOKEN_PREFIX))


def get_user_for_token(db: Session, raw_token: str) -> Optional[User]:
    """Resolve an API token to its owning user, updating last_used_at.

    Returns None when the token is unknown, revoked, or expired. Comparison
    uses a constant-time digest compare via ``hmac.compare_digest`` to avoid
    timing leaks even though the lookup column is already indexed by hash.
    """
    if not looks_like_api_token(raw_token):
        return None

    token_hash = hash_token(raw_token)
    token = (
        db.query(ApiToken)
        .filter(ApiToken.token_hash == token_hash)
        .first()
    )
    if token is None:
        return None

    # Defense-in-depth — even though the DB lookup is by hash, double-check
    # the hash hasn't been weakened by accidental case folding etc.
    if not hmac.compare_digest(token.token_hash, token_hash):
        return None
    if token.revoked_at is not None:
        return None
    if token.expires_at is not None and token.expires_at <= datetime.now(timezone.utc):
        return None

    # Update last_used_at; failures here shouldn't break the request.
    try:
        token.last_used_at = datetime.now(timezone.utc)
        db.commit()
    except Exception:
        db.rollback()

    user = db.query(User).filter(User.id == token.user_id).first()
    if user is None or not user.is_active:
        return None
    return user
