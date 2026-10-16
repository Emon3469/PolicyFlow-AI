from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]

PLACEHOLDER_PREFIXES = ("your_", "your-", "change-me", "replace", "xxx", "sk-...")


def _is_placeholder(value: str) -> bool:
    lowered = value.strip().lower()
    return not lowered or lowered.startswith(PLACEHOLDER_PREFIXES)


class Settings(BaseSettings):
    app_name: str = "PolicyFlow AI"
    app_env: str = "development"
    log_level: str = "INFO"

    cors_origins: str = "http://localhost:3000"
    cors_origin_regex: str = ""

    llm_providers: str = "openai,anthropic,groq,gemini"
    llm_timeout_seconds: float = 30.0
    llm_cooldown_seconds: int = 60

    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_fast_model: str = "gpt-4o-mini"

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5-5"
    anthropic_fast_model: str = "claude-haiku-5-5"

    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b"
    groq_fast_model: str = "qwen/qwen3.8-27b,openai/gpt-oss-20b,openai/gpt-oss-120b"

    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-lite-latest,gemini-3.5-flash-lite"
    gemini_fast_model: str = "gemini-flash-lite-latest"

    tavily_api_key: str = ""
    web_search_max_results: int = 5

    pinecone_api_key: str = ""
    pinecone_index_name: str = "policyflow-hr-kb"
    pinecone_namespace: str = "hr-docs"
    pinecone_cloud: str = "aws"
    pinecone_region: str = "us-east-1"

    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dimension: int = 384
    model_cache_dir: str = str(BASE_DIR / ".cache" / "fastembed")

    top_k: int = 4
    min_relevance_score: float = 0.25
    strong_relevance_score: float = 0.6
    max_retries: int = 1
    chunk_size: int = 900
    chunk_overlap: int = 120
    max_upload_mb: int = 10

    admin_api_key: str = ""
    audit_db_path: str = str(BASE_DIR / "data" / "policyflow.db")
    knowledge_base_dir: str = str(BASE_DIR / "data" / "knowledge_base")
    seed_knowledge_base: bool = True

    model_config = SettingsConfigDict(
        env_file=(str(BASE_DIR.parent / ".env"), str(BASE_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator(
        "openai_api_key", "anthropic_api_key", "groq_api_key", "gemini_api_key",
        "tavily_api_key", "pinecone_api_key", "admin_api_key",
        mode="before",
    )
    @classmethod
    def _drop_placeholders(cls, value: str | None) -> str:
        value = (value or "").strip()
        return "" if _is_placeholder(value) else value

    @property
    def provider_order(self) -> list[str]:
        return [p.strip().lower() for p in self.llm_providers.split(",") if p.strip()]

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
