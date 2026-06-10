from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
from typing import Optional
import secrets


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )
    
    database_url: str = "sqlite:///./test_management.db"
    secret_key: Optional[str] = None  # Must be set via environment variable
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 480  # 8 hours instead of 30 minutes
    refresh_token_expire_days: int = 7
    allowed_origins: str = "http://localhost:3000"
    auth_cookie_secure: bool = False
    auth_cookie_samesite: str = "lax"
    test_database_url: str = "sqlite:///./test_test.db"
    webhook_allow_private_urls: bool = False
    test_asset_stale_days: int = 180
    test_asset_always_pass_min_results: int = 5
    test_asset_duplicate_grace_days: int = 14
    
    @field_validator('secret_key', mode='before')
    @classmethod
    def generate_secret_key(cls, v):
        if v is not None and v != "":
            return v

        # No SECRET_KEY configured. A fresh random key on every startup would
        # invalidate all sessions AND make every encrypted value (global
        # parameters, Jira tokens, ...) permanently unrecoverable on restart.
        # Persist the auto-generated key to a local file so it stays stable in
        # development; production should still set SECRET_KEY explicitly.
        import os
        import warnings
        from pathlib import Path

        key_path = Path(os.environ.get("SECRET_KEY_FILE", ".secret_key"))
        try:
            if key_path.exists():
                existing = key_path.read_text().strip()
                if existing:
                    return existing
            generated = secrets.token_urlsafe(32)
            key_path.write_text(generated)
            try:
                os.chmod(key_path, 0o600)
            except OSError:
                pass
            warnings.warn(
                "SECRET_KEY not set; generated one and persisted it to "
                f"'{key_path}'. Set SECRET_KEY explicitly for production.",
                RuntimeWarning,
            )
            return generated
        except OSError:
            # Couldn't persist (e.g. read-only filesystem) — fall back to an
            # ephemeral key, but make the durability risk explicit.
            warnings.warn(
                "SECRET_KEY not set and a key file could not be written; using "
                "an ephemeral key. Sessions and encrypted data will NOT survive "
                "a restart. Set SECRET_KEY for production.",
                RuntimeWarning,
            )
            return secrets.token_urlsafe(32)


settings = Settings()
