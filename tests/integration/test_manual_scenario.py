"""End-to-end walkthrough of the manual ISL test scenario.

Replays the step-by-step manual testing guide — seed balances, plain
transfer, idempotent retry, key-reuse conflict, clean rejections, concurrent
same-key burst, audit, tamper detection — as one sequential test, exactly as
a human would run it with curl. Focused per-behavior tests live in
test_wallet_concurrency.py; this file intentionally retraces them in
narrative order so the whole flow is exercised against shared state.
"""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import select

from shared.models import LedgerEntry
from tests.integration.conftest import ALICE_ID, BOB_ID

pytestmark = pytest.mark.integration


def _body(from_id, to_id, amount: int, key: str | None = None) -> dict:
    body = {
        "from_user_id": str(from_id),
        "to_user_id": str(to_id),
        "amount": amount,
    }
    if key is not None:
        body["idempotency_key"] = key
    return body


async def _balance(client, user_id) -> int:
    response = await client.get(f"/wallets/{user_id}/balance")
    assert response.status_code == 200
    return response.json()["balance"]


async def _tamper_latest_entry(session_factory, delta: int) -> None:
    async with session_factory() as session:
        row = (
            await session.execute(
                select(LedgerEntry).order_by(LedgerEntry.id.desc()).limit(1)
            )
        ).scalar_one()
        row.amount += delta
        await session.commit()


async def test_manual_scenario_walkthrough(client, session_factory):
    # Step 1 — wallets created with the 1000 ISL genesis grant.
    for user_id in (ALICE_ID, BOB_ID):
        assert (await client.post(f"/wallets/{user_id}")).status_code == 201
    assert await _balance(client, ALICE_ID) == 1000
    assert await _balance(client, BOB_ID) == 1000

    # Step 2 — plain transfer without an idempotency key.
    response = await client.post(
        "/transactions/transfer", json=_body(ALICE_ID, BOB_ID, 100)
    )
    assert response.status_code == 200
    assert response.json()["idempotent_replay"] is False
    assert await _balance(client, ALICE_ID) == 900
    assert await _balance(client, BOB_ID) == 1100

    # Step 3 — idempotent retry: same key replays instead of double-spending.
    body = _body(ALICE_ID, BOB_ID, 50, key="manual-retry")
    first = await client.post("/transactions/transfer", json=body)
    second = await client.post("/transactions/transfer", json=body)
    assert first.status_code == second.status_code == 200
    assert first.json()["tx_id"] == second.json()["tx_id"]
    assert first.json()["idempotent_replay"] is False
    assert second.json()["idempotent_replay"] is True
    assert await _balance(client, ALICE_ID) == 850  # moved once, not twice

    # Step 4 — same key with different parameters is rejected.
    mismatch = await client.post(
        "/transactions/transfer",
        json=_body(ALICE_ID, BOB_ID, 999, key="manual-retry"),
    )
    assert mismatch.status_code == 409

    # Step 5 — clean rejections: insufficient balance, self-transfer.
    overdraft = await client.post(
        "/transactions/transfer", json=_body(ALICE_ID, BOB_ID, 99999)
    )
    assert overdraft.status_code == 400
    self_transfer = await client.post(
        "/transactions/transfer", json=_body(ALICE_ID, ALICE_ID, 10)
    )
    assert self_transfer.status_code == 400

    # Step 6 — 10 concurrent requests with one key move money exactly once.
    burst = _body(BOB_ID, ALICE_ID, 30, key="manual-burst")
    responses = await asyncio.gather(*[
        client.post("/transactions/transfer", json=burst) for _ in range(10)
    ])
    assert all(r.status_code == 200 for r in responses)
    assert len({r.json()["tx_id"] for r in responses}) == 1
    originals = [r for r in responses if r.json()["idempotent_replay"] is False]
    assert len(originals) == 1
    assert await _balance(client, ALICE_ID) == 880
    assert await _balance(client, BOB_ID) == 1120

    # Step 7 — audit passes: 2 genesis + steps 2, 3 and 6.
    audit = (await client.get("/audit/ledger")).json()
    assert audit["ok"] is True, audit["anomalies"]
    assert audit["transactions_checked"] == 5

    # Step 8 — tamper with one ledger row; the audit must catch it.
    await _tamper_latest_entry(session_factory, +1)
    audit = (await client.get("/audit/ledger")).json()
    assert audit["ok"] is False
    kinds = {a["kind"] for a in audit["anomalies"]}
    assert "tx_invariant" in kinds  # debit/credit no longer sum to zero
    assert "balance" in kinds  # materialized balance drifted from ledger sum

    # Restore the row; the ledger is consistent again.
    await _tamper_latest_entry(session_factory, -1)
    audit = (await client.get("/audit/ledger")).json()
    assert audit["ok"] is True, audit["anomalies"]
