"""Per-user notification events.

Each logged-in user has a Redis stream `stream:user:{user_id}` that the gateway
forwards to the user's WebSocket connection. Services that want to push a
notification (e.g. "someone is visiting your island", "DM received", "RPS
invitation") publish into this stream via `publish_user_event`.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from shared.redis_client import get_redis


def user_stream_key(user_id: UUID) -> str:
    return f"stream:user:{user_id}"


async def publish_user_event(
    user_id: UUID,
    event_type: str,
    data: dict[str, Any],
) -> None:
    """Publish an event into the user's notification stream.

    Redis Streams require flat string values; we coerce all field values to
    strings here, dropping any None entries (matching the visit/dm convention).
    """
    payload: dict[str, str] = {"type": event_type}
    for k, v in data.items():
        if v is None:
            continue
        payload[k] = str(v)
    r = get_redis()
    await r.xadd(user_stream_key(user_id), payload)
