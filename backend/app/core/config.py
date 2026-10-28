from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", protected_namespaces=("settings_",))

    environment: str = "development"
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""
    supabase_jwks_url: str = ""
    cors_origins: str = "http://localhost:5173"
    model_path: str = ""
    min_confidence: float = 0.6
    max_upload_size_mb: int = 5
    scans_per_minute: int = 10

    @property
    def origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    @property
    def jwks_url(self) -> str:
        return self.supabase_jwks_url or f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"

    @property
    def issuer(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1"


@lru_cache
def get_settings() -> Settings:
    return Settings()
