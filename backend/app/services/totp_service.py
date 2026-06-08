"""TOTP helpers for two-factor authentication."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import struct
import time
from urllib.parse import quote

from ..crypto import decrypt_data, encrypt_data


TOTP_DIGITS = 6
TOTP_PERIOD_SECONDS = 30
TOTP_WINDOW = 1
RECOVERY_CODE_COUNT = 10
RECOVERY_CODE_BYTES = 5


def generate_totp_secret() -> str:
    """Generate a Base32 secret suitable for authenticator apps."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def normalize_totp_code(code: str | None) -> str:
    return "".join(char for char in str(code or "") if char.isdigit())


def provisioning_uri(account_name: str, secret: str, issuer: str) -> str:
    normalized_issuer = issuer.strip() or "TestMona"
    label = quote(f"{normalized_issuer}:{account_name}")
    issuer_param = quote(normalized_issuer)
    return (
        f"otpauth://totp/{label}?secret={secret}"
        f"&issuer={issuer_param}&algorithm=SHA1&digits={TOTP_DIGITS}&period={TOTP_PERIOD_SECONDS}"
    )


def verify_totp(secret: str | None, code: str | None, *, now: int | None = None) -> bool:
    normalized_code = normalize_totp_code(code)
    if not secret or len(normalized_code) != TOTP_DIGITS:
        return False

    current_time = int(time.time() if now is None else now)
    current_counter = current_time // TOTP_PERIOD_SECONDS
    return any(
        hmac.compare_digest(_totp_at(secret, current_counter + offset), normalized_code)
        for offset in range(-TOTP_WINDOW, TOTP_WINDOW + 1)
    )


def encrypt_totp_secret(secret: str) -> str:
    return encrypt_data(secret)


def decrypt_totp_secret(stored_secret: str | None) -> tuple[str | None, bool]:
    if not stored_secret:
        return None, True
    try:
        return decrypt_data(stored_secret), True
    except ValueError:
        # Secrets written before encryption was introduced are accepted once and
        # re-encrypted by callers that have a database session.
        return stored_secret, False


def generate_recovery_codes() -> list[str]:
    return [secrets.token_hex(RECOVERY_CODE_BYTES).upper() for _ in range(RECOVERY_CODE_COUNT)]


def encrypt_recovery_code_hashes(codes: list[str]) -> str:
    return encrypt_data(json.dumps([_hash_recovery_code(code) for code in codes]))


def verify_and_consume_recovery_code(stored_hashes: str | None, code: str | None) -> tuple[bool, str | None]:
    if not stored_hashes or not code:
        return False, stored_hashes

    try:
        hashes = json.loads(decrypt_data(stored_hashes))
    except (ValueError, json.JSONDecodeError, TypeError):
        return False, stored_hashes

    submitted_hash = _hash_recovery_code(code)
    remaining = []
    matched = False
    for stored_hash in hashes:
        if not matched and hmac.compare_digest(str(stored_hash), submitted_hash):
            matched = True
            continue
        remaining.append(stored_hash)

    if not matched:
        return False, stored_hashes
    return True, encrypt_data(json.dumps(remaining))


def _hash_recovery_code(code: str) -> str:
    normalized = "".join(char for char in str(code or "").upper() if char.isalnum())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _totp_at(secret: str, counter: int) -> str:
    padded_secret = secret + "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(padded_secret, casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10 ** TOTP_DIGITS)).zfill(TOTP_DIGITS)
