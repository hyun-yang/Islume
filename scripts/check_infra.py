"""Verify Redis and Postgres are reachable from Python."""
import asyncio
import os

from dotenv import load_dotenv

load_dotenv()


async def check_redis():
    import redis.asyncio as redis
    client = redis.from_url(os.getenv("REDIS_URL"))
    pong = await client.ping()
    info = await client.info("server")
    await client.aclose()
    return pong, info["redis_version"]


async def check_postgres():
    import asyncpg
    conn = await asyncpg.connect(os.getenv("DATABASE_URL"))
    version = await conn.fetchval("SELECT version()")
    await conn.close()
    return version


async def main():
    print("Checking Redis...")
    try:
        pong, version = await check_redis()
        print(f"  OK — ping={pong}, version={version}")
    except Exception as e:
        print(f"  FAIL — {e}")

    print("Checking Postgres...")
    try:
        version = await check_postgres()
        print(f"  OK — {version[:60]}...")
    except Exception as e:
        print(f"  FAIL — {e}")


if __name__ == "__main__":
    asyncio.run(main())
