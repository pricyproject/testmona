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
    test_database_url: str = "sqlite:///./test_test.db"
    webhook_allow_private_urls: bool = False
    
    @field_validator('secret_key', mode='before')
    @classmethod
    def generate_secret_key(cls, v):
        if v is None or v == "":
            import warnings
            warnings.warn(
                "SECRET_KEY not set in environment variables. Using auto-generated key. "
                "This is NOT secure for production! Set SECRET_KEY environment variable.",
                RuntimeWarning
            )
            return secrets.token_urlsafe(32)
        return v


settings = Settings()
