"""Shared configuration loaded from environment variables."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database
    database_url: str

    # Redis
    redis_url: str

    # LLM — API keys
    anthropic_api_key: str = "placeholder"
    openai_api_key: str = ""
    gemini_api_key: str = ""
    ollama_base_url: str = "http://localhost:11434"
    sakana_ai_api_key: str = ""
    sakana_base_url: str = "https://api.sakana.ai/v1"

    # LLM — system model (for internal calls: similarity, affinity)
    system_llm_model: str = "claude-haiku-4-5"
    max_semantic_pairs: int = 20

    # LLM — model lists (comma-separated, first = default)
    anthropic_models: str = "claude-sonnet-4-5,claude-haiku-4-5"
    openai_models: str = ""
    gemini_models: str = ""
    ollama_models: str = ""
    sakana_models: str = ""

    # LLM — explicit default chat model (e.g. "openai/gpt-5-mini"). Used for
    # agents whose owner hasn't set a preferred_model. Empty falls back to the
    # first entry of the model lists above.
    default_chat_model: str = ""

    # Wallet
    wallet_master_key: str = ""
    wallet_service_url: str = "http://localhost:8004"

    # App
    log_level: str = "INFO"
    environment: str = "development"

    # Langfuse / OTel
    langfuse_host: str = "http://localhost:3100"
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    otel_service_name: str = "islume"
    otel_enabled: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
