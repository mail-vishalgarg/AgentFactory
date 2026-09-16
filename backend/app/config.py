from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/postgres"
    gemini_api_key: str = ""
    google_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    frontend_origin: str = "http://localhost:5173"
    jwt_secret: str = "change-me-to-a-random-secret"
    jwt_expire_minutes: int = 60
    my_mcp_registry_db: str = "/Users/priyankaneogi/Desktop/my-mcp-registry/backend/registry.db"

    model_config = SettingsConfigDict(env_file="../.env", extra="ignore")

    @property
    def active_gemini_api_key(self) -> str:
        return self.gemini_api_key or self.google_api_key

    @field_validator("database_url", mode="before")
    @classmethod
    def ensure_asyncpg(cls, v: str) -> str:
        """Rewrite plain postgresql:// URLs to use the asyncpg driver."""
        if isinstance(v, str) and v.startswith("postgresql://"):
            return v.replace("postgresql://", "postgresql+asyncpg://", 1)
        return v


settings = Settings()
