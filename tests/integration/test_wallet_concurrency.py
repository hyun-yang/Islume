"""Concurrency + idempotency integration tests for the wallet service."""

from __future__ import annotations

import asyncio
from uuid import UUID

import pytest
from sqlalchemy import func as sa_func
from sqlalchemy import select

from services.wallet.idempotency import derive_tx_id
from shared.models import LedgerEntry, User, Wallet
from tests.integration.conftest import ALICE_ID, BOB_ID

pytestmark = pytest.mark.integration


async def _create_wallets(client) -> None:
    for user_id in (ALICE_ID, BOB_ID):
        response = await client.post(f"/wallets/{user_id}")
        assert response.status_code == 201, response.text


def _transfer_body(amount: int, key: str | None = None) -> dict:
    body = {
        "from_user_id": str(ALICE_ID),
        "to_user_id": str(BOB_ID),
        "amount": amount,
    }
    if key is not None:
        body["idempotency_key"] = key
    return body


async def _balance(client, user_id) -> int:
    response = await client.get(f"/wallets/{user_id}/balance")
    assert response.status_code == 200
    return response.json()["balance"]


async def _ledger_rows(session_factory, tx_id) -> int:
    async with session_factory() as session:
        result = await session.execute(
            select(sa_func.count()).where(LedgerEntry.tx_id == tx_id)
        )
        return result.scalar_one()


async def test_parallel_transfers_never_overdraft(client, session_factory):
    await _create_wallets(client)
    # 20 x 100 = 2000 demanded from a 1000 balance: exactly 10 must succeed.
    responses = await asyncio.gather(*[
        client.post("/transactions/transfer", json=_transfer_body(100))
        for _ in range(20)
    ])
    successes = [r for r in responses if r.status_code == 200]
    failures = [r for r in responses if r.status_code == 400]
    assert len(successes) + len(failures) == 20
    assert len(successes) == 10

    assert await _balance(client, ALICE_ID) == 0
    assert await _balance(client, BOB_ID) == 2000

    # Materialized balances must equal ledger sums.
    async with session_factory() as session:
        result = await session.execute(
            select(Wallet.id, Wallet.balance, sa_func.coalesce(
                select(sa_func.sum(LedgerEntry.amount))
                .where(LedgerEntry.account_id == Wallet.id)
                .scalar_subquery(), 0,
            ))
        )
        for _, balance, ledger_sum in result.all():
            assert balance == int(ledger_sum)


async def test_idempotent_retry_sequential(client, session_factory):
    await _create_wallets(client)
    first = await client.post(
        "/transactions/transfer", json=_transfer_body(30, key="retry-seq")
    )
    second = await client.post(
        "/transactions/transfer", json=_transfer_body(30, key="retry-seq")
    )
    assert first.status_code == second.status_code == 200
    assert first.json()["tx_id"] == second.json()["tx_id"]
    assert first.json()["idempotent_replay"] is False
    assert second.json()["idempotent_replay"] is True

    tx_id = derive_tx_id(ALICE_ID, "retry-seq")
    assert str(tx_id) == first.json()["tx_id"]
    assert await _ledger_rows(session_factory, tx_id) == 2
    assert await _balance(client, ALICE_ID) == 970


async def test_idempotent_retry_concurrent(client, session_factory):
    await _create_wallets(client)
    responses = await asyncio.gather(*[
        client.post("/transactions/transfer", json=_transfer_body(7, key="burst"))
        for _ in range(10)
    ])
    assert all(r.status_code == 200 for r in responses)
    tx_ids = {r.json()["tx_id"] for r in responses}
    assert len(tx_ids) == 1

    assert await _ledger_rows(session_factory, derive_tx_id(ALICE_ID, "burst")) == 2
    assert await _balance(client, ALICE_ID) == 993
    assert await _balance(client, BOB_ID) == 1007


async def test_key_reuse_with_different_params_conflicts(client):
    await _create_wallets(client)
    first = await client.post(
        "/transactions/transfer", json=_transfer_body(10, key="reused")
    )
    assert first.status_code == 200
    mismatch = await client.post(
        "/transactions/transfer", json=_transfer_body(11, key="reused")
    )
    assert mismatch.status_code == 409


async def test_insufficient_balance_rejected(client):
    await _create_wallets(client)
    response = await client.post(
        "/transactions/transfer", json=_transfer_body(1001)
    )
    assert response.status_code == 400


async def test_create_wallet_race(client, session_factory):
    race_id = UUID("00000003-0000-0000-0000-00000000cccc")
    async with session_factory() as session:
        session.add(User(id=race_id, display_name="Race", email="race@islume.test"))
        await session.commit()

    responses = await asyncio.gather(
        client.post(f"/wallets/{race_id}"),
        client.post(f"/wallets/{race_id}"),
    )
    assert sorted(r.status_code for r in responses) == [201, 409]

    async with session_factory() as session:
        count = await session.execute(
            select(sa_func.count()).where(Wallet.user_id == race_id)
        )
        assert count.scalar_one() == 1
        genesis_rows = await session.execute(
            select(sa_func.count())
            .select_from(LedgerEntry)
            .join(Wallet, Wallet.id == LedgerEntry.account_id)
            .where(Wallet.user_id == race_id)
        )
        assert genesis_rows.scalar_one() == 1  # credit side only


async def test_audit_ok_after_activity(client):
    await _create_wallets(client)
    for i in range(3):
        response = await client.post(
            "/transactions/transfer", json=_transfer_body(5, key=f"audit-{i}")
        )
        assert response.status_code == 200

    audit = await client.get("/audit/ledger")
    assert audit.status_code == 200
    payload = audit.json()
    assert payload["ok"] is True, payload["anomalies"]
    assert payload["transactions_checked"] == 5  # 2 genesis + 3 transfers
