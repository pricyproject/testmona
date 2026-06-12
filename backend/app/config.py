from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import ValidationInfo, field_validator
from typing import Optional
import secrets


# Values of ``ENVIRONMENT`` that mean "this is a real deployment, fail fast on
# misconfiguration" rather than a developer's machine.
_PRODUCTION_ENVIRONMENTS = {"production", "prod", "staging", "stage"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # Declared before ``secret_key`` so it is validated first and is therefore
    # available via ``info.data`` inside the secret_key validator.
    environment: str = "development"
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

    # Logging. ``log_level`` is a standard level name (DEBUG/INFO/WARNING/...).
    # ``log_format`` selects the renderer: ``json`` for ingestion-friendly
    # one-line-per-event output, ``console`` for human-readable colour output.
    # When left empty it auto-selects: JSON in production-like environments,
    # console otherwise (see app/logging_config.py).
    log_level: str = "INFO"
    log_format: Optional[str] = None

    @field_validator('secret_key', mode='before')
    @classmethod
    def generate_secret_key(cls, v, info: ValidationInfo):
        if v is not None and v != "":
            return v

        # No SECRET_KEY configured. In a real deployment this is fatal: each
        # process/replica would otherwise generate its own key, which (a) makes
        # JWTs signed by one pod fail validation on another (random 401s /
        # login loops) and (b) makes Fernet-encrypted secrets (Jira tokens, AI
        # API keys, global parameters) written by one pod undecryptable by the
        # rest. Fail fast instead of corrupting silently under horizontal scaling.
        environment = str(info.data.get("environment", "development")).strip().lower()
        if environment in _PRODUCTION_ENVIRONMENTS:
            raise ValueError(
                f"SECRET_KEY is required when ENVIRONMENT={environment!r}. Without "
                "it, multiple replicas each generate a different key, breaking JWT "
                "validation and making encrypted secrets undecryptable across pods. "
                "Generate one with: "
                'python -c "import secrets; print(secrets.token_urlsafe(32))"'
            )

        # Development only: a fresh random key on every startup would invalidate
        # all sessions AND make every encrypted value permanently unrecoverable
        # on restart. Persist the auto-generated key to a local file so it stays
        # stable across restarts on a single machine.
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
