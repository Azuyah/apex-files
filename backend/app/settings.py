from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    app_secret: str = Field(default="dev-apex-files-secret", validation_alias="APP_SECRET")
    database_url: str = "sqlite:///./apex_files.db"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    storage_root: str = "backend/storage"
    revtech_integration_mode: str = "revtech"
    revtech_api_base_url: str = "https://files.revtechfiles.com/api/proxy"
    revtech_service_token: str = ""
    revtech_timeout_seconds: int = 600
    temp_admin_enabled: bool = True
    temp_admin_username: str = "admin"
    temp_admin_password: str = "admin"

    model_config = SettingsConfigDict(
        env_file=("backend/.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def storage_path(self) -> Path:
        return Path(self.storage_root).resolve()

    @property
    def sqlalchemy_database_url(self) -> str:
        if self.database_url.startswith("postgresql://"):
            return self.database_url.replace("postgresql://", "postgresql+psycopg://", 1)
        return self.database_url

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def revtech_enabled(self) -> bool:
        return self.revtech_integration_mode.strip().lower() == "revtech"

    @property
    def revtech_configured(self) -> bool:
        return bool(self.revtech_enabled and self.revtech_service_token.strip())


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
