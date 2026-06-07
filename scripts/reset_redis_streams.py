"""Reset Islume's ephemeral Redis state between test runs.

Clears the task queue and all event streams (session/user/visit/chat/dm/
wallet), plus per-run runtime keys (geo positions, visit/RPS locks). Postgres
— the source of truth for completed conversations and ledger state — is left
untouched; only Redis "what's happening now" state is wiped.

The LLM task stream is deleted *and then* its consumer group is recreated, so
a worker that is already running survives the reset (a bare DEL would leave it
hitting NOGROUP on the next XREADGROUP). This mirrors the worker's idempotent
group creation in services/worker/main.py.

Usage:
    uv run python scripts/reset_redis_streams.py            # streams + geo + locks
    uv run python scripts/reset_redis_streams.py --keep-geo # preserve seeded positions
    uv run python scripts/reset_redis_streams.py --all      # also drop wallet balance caches
"""
import asyncio
import sys

from shared.messages import CONSUMER_GROUP, STREAM_LLM_TASKS
from shared.redis_client import close_redis, get_redis


async def _delete_matching(r, pattern: str) -> int:
    """Delete every key matching a glob pattern via SCAN (never KEYS)."""
    deleted = 0
    async for key in r.scan_iter(match=pattern, count=200):
        await r.delete(key)
        deleted += 1
    return deleted


async def reset(keep_geo: bool = False, drop_wallet_cache: bool = False) -> None:
    r = get_redis()

    # 1. Event/task streams. Delete the task queue first, then recreate its
    #    consumer group so a running worker keeps consuming.
    await r.delete(STREAM_LLM_TASKS)
    try:
        await r.xgroup_create(STREAM_LLM_TASKS, CONSUMER_GROUP, id="0", mkstream=True)
    except Exception as e:  # noqa: BLE001 — only BUSYGROUP is expected/ignorable
        if "BUSYGROUP" not in str(e):
            raise

    stream_keys = 0
    for pattern in (
        "stream:session:*",
        "stream:user:*",
        "stream:visit:*",
        "stream:chat:*",
        "stream:dm:*",
        "stream:wallet:*",
    ):
        stream_keys += await _delete_matching(r, pattern)

    # 2. Per-run runtime locks (visit / RPS sessions live only in Redis).
    locks = 0
    for pattern in ("visit:active:*", "visit:rps:active:*"):
        locks += await _delete_matching(r, pattern)

    # 3. Geo positions (seeded). Preserve with --keep-geo.
    geo_cleared = False
    if not keep_geo:
        geo_cleared = bool(await r.delete("geo:islands"))

    # 4. Wallet balance caches (derived from the Postgres ledger). Off by
    #    default — the wallet service recomputes on miss, but dropping them
    #    is only wanted on an explicit full reset.
    wallet_cache = 0
    if drop_wallet_cache:
        wallet_cache = await _delete_matching(r, "wallet:balance:*")

    await close_redis()

    print("Redis ephemeral state reset:")
    print(f"  {STREAM_LLM_TASKS} cleared + consumer group '{CONSUMER_GROUP}' recreated")
    print(f"  {stream_keys} event stream(s) deleted")
    print(f"  {locks} visit/RPS lock(s) deleted")
    print(f"  geo:islands {'preserved' if keep_geo else ('cleared' if geo_cleared else 'absent')}")
    if drop_wallet_cache:
        print(f"  {wallet_cache} wallet balance cache(s) deleted")


if __name__ == "__main__":
    args = set(sys.argv[1:])
    asyncio.run(reset(keep_geo="--keep-geo" in args, drop_wallet_cache="--all" in args))
