"""Shared Redis client factory."""
import redis.asyncio as redis

from shared.config import get_settings

_client: redis.Redis | None = None


def get_redis() -> redis.Redis:
    global _client
    if _client is None:
        settings = get_settings()
        _client = redis.from_url(
            settings.redis_url,
            decode_responses=True,
            health_check_interval=30,
            # redis-py 8.0 changed the default socket_timeout from None to 5s,
            # which kills any blocking XREAD/XREADGROUP idling past 5s — the
            # gateway and worker block for up to 30s by design.
            socket_timeout=None,
        )
    return _client


async def close_redis() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
