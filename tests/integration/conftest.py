"""Integration fixtures: real Postgres (islume_test) + Redis db 15.

The whole suite is skipped unless ISLUME_TEST_DATABASE_URL is set, e.g.:

    docker exec islume-postgres psql -U islume -d islume_dev \
        -c "CREATE DATABASE islume_test;"   # once
    ISLUME_TEST_DATABASE_URL=postgresql+asyncpg://islume:islume@localhost:5432/islume_test \
        uv run pytest tests/integration -m integration

Each test gets a freshly created schema and a flushed Redis db 15; the app is
driven in-process via httpx.ASGITransport with the get_session dependency
overridden, so the suite needs no running wallet service.
"""

from __future__ import annotations

import os
from uuid import UUID

import httpx
import pytest
import redis.asyncio as redis
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import shared.redis_client as redis_client_module
from shared.config import get_settings
from shared.crypto import generate_keypair
from shared.models import Base, User, Wallet

TEST_DB_URL = os.environ.get("ISLUME_TEST_DATABASE_URL")

SYSTEM_USER_ID = UUID("00000000-0000-0000-0000-000000000000")
ALICE_ID = UUID("00000001-0000-0000-0000-00000000aaaa")
BOB_ID = UUID("00000002-0000-0000-0000-00000000bbbb")


@pytest.fixture
def db_url() -> str:
    if not TEST_DB_URL:
        pytest.skip("ISLUME_TEST_DATABASE_URL not set")
    return TEST_DB_URL


@pytest.fixture
async def engine(db_url):
    # Pool sized above the largest gather() in the suite so concurrent
    # requests contend on row locks, not connection checkout.
    engine = create_async_engine(db_url, pool_size=25, max_overflow=10)
    yield engine
    await engine.dispose()


@pytest.fixture
async def session_factory(engine):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest.fixture
async def test_redis(monkeypatch):
    """Point the shared Redis singleton at db 15 and flush it."""
    settings = get_settings()
    client = redis.from_url(
        settings.redis_url, db=15, decode_responses=True, socket_timeout=None
    )
    await client.flushdb()
    monkeypatch.setattr(redis_client_module, "_client", client)
    yield client
    await client.aclose()


@pytest.fixture
async def seeded(session_factory):
    """System wallet + Alice/Bob user rows (wallets created via the API)."""
    if not get_settings().wallet_master_key:
        pytest.skip("WALLET_MASTER_KEY not set")
    async with session_factory() as session:
        session.add(User(
            id=SYSTEM_USER_ID, display_name="System", email="system@islume.test"
        ))
        session.add(User(id=ALICE_ID, display_name="Alice", email="alice@islume.test"))
        session.add(User(id=BOB_ID, display_name="Bob", email="bob@islume.test"))
        public_key, encrypted_private_key = generate_keypair()
        session.add(Wallet(
            user_id=SYSTEM_USER_ID, public_key=public_key,
            encrypted_private_key=encrypted_private_key, balance=0,
        ))
        await session.commit()


@pytest.fixture
async def client(session_factory, test_redis, seeded):
    from services.wallet.main import app, get_session

    async def override_session():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
