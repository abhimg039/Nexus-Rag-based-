from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Application configuration.

    Every value can be overridden through the environment or the .env file at
    the project root. Defaults are chosen so the app runs with nothing but
    DATABASE_URL set.
    """

    # --- App ---
    app_name: str = "AI Document Intelligence & RAG Platform"
    app_version: str = "2.0.0"
    environment: str = "development"

    # --- Database (required) ---
    database_url: str
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_pool_recycle: int = 1800

    # --- Ollama / LLM ---
    ollama_base_url: str = "http://localhost:11434"
    llm_model: str = "llama3.2:3b"
    llm_timeout: int = 120
    llm_temperature: float = 0.1
    llm_max_tokens: int = 800
    # Keeps the model resident in Ollama so questions after the first one do
    # not pay the model load cost again.
    llm_keep_alive: str = "30m"

    # --- Embeddings ---
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_dimensions: int = 384
    embedding_batch_size: int = 32
    warm_up_embedding_model: bool = True

    # --- Chunking ---
    chunk_size: int = 1000
    chunk_overlap: int = 200

    # --- Retrieval ---
    retrieval_top_k: int = 5
    retrieval_candidate_multiplier: int = 4
    keyword_boost: float = 0.08

    # --- Uploads ---
    upload_dir: str = "uploads"
    max_upload_mb: int = 50

    # --- CORS ---
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env", BACKEND_ROOT / ".env"),
        extra="ignore",
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value):
        """Accept CORS_ORIGINS as a comma-separated string."""
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @property
    def ollama_generate_url(self) -> str:
        return f"{self.ollama_base_url.rstrip('/')}/api/generate"

    @property
    def ollama_tags_url(self) -> str:
        return f"{self.ollama_base_url.rstrip('/')}/api/tags"

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def upload_path(self) -> Path:
        """Absolute upload directory, so the server works from any cwd.

        Previously this was the relative path "uploads", which silently
        resolved against whatever directory uvicorn was started from.
        """
        candidate = Path(self.upload_dir)
        if not candidate.is_absolute():
            candidate = BACKEND_ROOT / candidate
        return candidate


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
