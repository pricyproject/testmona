"""First-run setup protection.

A brand-new instance has no accounts, so the endpoint that creates the very
first administrator is necessarily unauthenticated. To stop a stranger who
reaches the instance before the operator from claiming that admin account, the
endpoint requires a one-time **setup token** that is only visible to whoever
controls the server: it is printed to the logs at startup and written to a
``0600`` file. This mirrors how GitLab / Jenkins protect their initial-admin
step.

Two independent gates protect first-run setup:
  1. ``needs_setup`` — once any account exists, setup is permanently closed.
  2. ``verify_setup_token`` — during the open window, the caller must present
     the token (constant-time compared).
"""
from __future__ import annotations

import hmac
import logging
import os
import secrets
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from .models import User

logger = logging.getLogger(__name__)

# Resolve relative to the backend directory so it doesn't depend on CWD.
_DEFAULT_TOKEN_PATH = Path(__file__).resolve().parent.parent / ".setup_token"
SETUP_TOKEN_FILE = Path(os.environ.get("SETUP_TOKEN_FILE", str(_DEFAULT_TOKEN_PATH)))


def needs_setup(db: Session) -> bool:
    """True while no account exists yet (the first-run window)."""
    return db.query(User).count() == 0


def _read_token_file() -> Optional[str]:
    try:
        if SETUP_TOKEN_FILE.exists():
            return SETUP_TOKEN_FILE.read_text().strip() or None
    except OSError:
        return None
    return None


def current_setup_token() -> str:
    """Return the active setup token, generating and persisting one if needed.

    An explicit ``SETUP_TOKEN`` environment variable always wins (handy for
    automated/headless provisioning). Otherwise a high-entropy token is
    generated once and stored in a ``0600`` file so it survives restarts during
    setup.
    """
    env_token = os.environ.get("SETUP_TOKEN")
    if env_token and env_token.strip():
        return env_token.strip()

    existing = _read_token_file()
    if existing:
        return existing

    token = secrets.token_urlsafe(32)
    try:
        SETUP_TOKEN_FILE.write_text(token)
        try:
            os.chmod(SETUP_TOKEN_FILE, 0o600)
        except OSError:
            pass
    except OSError:
        logger.warning(
            "Could not persist the setup token to %s; it will change on restart.",
            SETUP_TOKEN_FILE,
        )
    return token


def verify_setup_token(provided: Optional[str]) -> bool:
    """Constant-time check of a caller-supplied setup token."""
    if not provided:
        return False
    return hmac.compare_digest(provided.strip(), current_setup_token())


def clear_setup_token() -> None:
    """Invalidate the token once setup completes (best-effort)."""
    try:
        if SETUP_TOKEN_FILE.exists():
            SETUP_TOKEN_FILE.unlink()
    except OSError:
        pass


def announce_setup_token(db: Session) -> None:
    """Print the setup token prominently while the instance still needs setup."""
    try:
        if not needs_setup(db):
            return
        token = current_setup_token()
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Could not prepare the setup token: %s", exc)
        return

    rule = "=" * 72
    banner = (
        f"\n{rule}\n"
        "FIRST-RUN SETUP REQUIRED\n"
        "Open the app and create your administrator. When prompted for the\n"
        f"setup token, paste the value below (also saved to {SETUP_TOKEN_FILE}):\n\n"
        f"    {token}\n\n"
        "Anyone with this token can create the first admin — keep it private.\n"
        f"{rule}"
    )
    logger.info(banner)
