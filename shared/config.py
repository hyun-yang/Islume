"""Shared configuration loaded from environment variables."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

# Hard ceiling on a session's total turns across max_turns extensions.
# At this cap the worker completes the session instead of pausing for review,
# and the orchestrator refuses further extensions — bounds LLM cost.
MAX_TOTAL_TURNS = 120


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

    # Solana / SPL withdrawal (hybrid: Postgres ledger is source of truth,
    # SPL tokens minted on-chain only on withdrawal). Devnet defaults.
    solana_rpc_url: str = "https://api.devnet.solana.com"
    solana_cluster: str = "devnet"  # devnet | testnet | mainnet-beta
    solana_commitment: str = "confirmed"  # processed | confirmed | finalized
    solana_isl_mint: str = ""  # mint pubkey (base58) from scripts/solana_create_mint.py
    solana_mint_authority_secret: str = ""  # base58 OR 64-byte hex secret — NEVER commit
    solana_decimals: int = 0  # 1 ISL == 1 base unit (guard; keep 0)
    solana_rpc_timeout: float = 30.0  # AsyncClient HTTP timeout (seconds)
    solana_confirm_timeout: float = 60.0  # max seconds to wait for confirmation
    solana_mint_max_attempts: int = 3  # reclaim attempts before marking failed
    solana_min_withdrawal: int = 1  # smallest ISL amount allowed to withdraw
    solana_max_supply: int = 0  # on-chain SPL supply cap in ISL; 0 = unlimited

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
