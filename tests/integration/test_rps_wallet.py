"""RPS <-> wallet integration: round settlement through the hardened transfer.

services.visit.rps talks to the wallet service over HTTP. Here that hop is
routed in-process: a stand-in for the httpx module inside rps.py returns
clients backed by ASGITransport against the real wallet app (or by a refusing
transport to simulate a wallet outage), so the full settle path — balance
pre-check, idempotency-keyed transfer, retries, cancel — runs against the
real database without a running wallet service.
"""

from __future__ import annotations

from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select

from services.visit import rps
from services.wallet.idempotency import derive_tx_id
from shared.models import LedgerEntry, VisitSession
from tests.integration.conftest import ALICE_ID, BOB_ID

pytestmark = pytest.mark.integration


class _WalletLink:
    """httpx-module stand-in for services.visit.rps with a kill switch.

    rps.py resolves `httpx.AsyncClient` (and the exception classes) through
    its module-global `httpx` at call time, so swapping that one attribute
    reroutes every wallet call. Flip `down` to simulate an outage mid-test.
    """

    def __init__(self, wallet_app):
        self._wallet_app = wallet_app
        self.down = False
        self.TransportError = httpx.TransportError
        self.HTTPError = httpx.HTTPError
        self.AsyncClient = self._make_client

    def _make_client(self, **kwargs):
        if self.down:
            def _refuse(_request):
                raise httpx.ConnectError("wallet down")

            transport: httpx.AsyncBaseTransport = httpx.MockTransport(_refuse)
        else:
            transport = httpx.ASGITransport(app=self._wallet_app)
        return httpx.AsyncClient(transport=transport, **kwargs)


@pytest.fixture
async def wallet_link(client, monkeypatch):
    """Route rps.py's outbound wallet HTTP calls to the in-process app."""
    from services.wallet.main import app as wallet_app

    link = _WalletLink(wallet_app)
    monkeypatch.setattr(rps, "httpx", link)
    return link


@pytest.fixture
async def visit_id(client, session_factory):
    """Alice visiting Bob, with both wallets funded by the genesis grant."""
    for user_id in (ALICE_ID, BOB_ID):
        response = await client.post(f"/wallets/{user_id}")
        assert response.status_code == 201, response.text
    vid = uuid4()
    async with session_factory() as session:
        session.add(VisitSession(id=vid, visitor_id=ALICE_ID, host_id=BOB_ID))
        await session.commit()
    return vid


async def _balance(client, user_id) -> int:
    response = await client.get(f"/wallets/{user_id}/balance")
    assert response.status_code == 200
    return response.json()["balance"]


async def _rps_ledger_rows(session_factory) -> list[LedgerEntry]:
    async with session_factory() as session:
        result = await session.execute(
            select(LedgerEntry).where(LedgerEntry.tx_type == "rps_bet")
        )
        return list(result.scalars())


async def test_round_settles_through_wallet(
    client, session_factory, wallet_link, visit_id
):
    async with session_factory() as session:
        round_ = await rps.create_round(visit_id, ALICE_ID, session)
        await rps.submit_pick(visit_id, round_.round_id, ALICE_ID, "rock", session)
        final = await rps.submit_pick(
            visit_id, round_.round_id, BOB_ID, "scissors", session
        )

    assert final.status == "revealed"
    assert final.outcome == "win"  # from the visitor's (Alice's) perspective
    assert final.winner_id == ALICE_ID

    assert await _balance(client, ALICE_ID) == 1010
    assert await _balance(client, BOB_ID) == 990

    # The settle transfer is keyed rps:{round_id}, scoped to the loser/sender.
    tx_id = derive_tx_id(BOB_ID, f"rps:{round_.round_id}")
    async with session_factory() as session:
        result = await session.execute(
            select(LedgerEntry).where(LedgerEntry.tx_id == tx_id)
        )
        rows = list(result.scalars())
    assert len(rows) == 2
    assert all(row.tx_type == "rps_bet" for row in rows)

    audit = (await client.get("/audit/ledger")).json()
    assert audit["ok"] is True, audit["anomalies"]


async def test_draw_moves_no_money(client, session_factory, wallet_link, visit_id):
    async with session_factory() as session:
        round_ = await rps.create_round(visit_id, ALICE_ID, session)
        await rps.submit_pick(visit_id, round_.round_id, ALICE_ID, "rock", session)
        final = await rps.submit_pick(
            visit_id, round_.round_id, BOB_ID, "rock", session
        )

    assert final.status == "revealed"
    assert final.outcome == "draw"
    assert final.winner_id is None
    assert await _balance(client, ALICE_ID) == 1000
    assert await _balance(client, BOB_ID) == 1000
    assert await _rps_ledger_rows(session_factory) == []


async def test_wallet_down_blocks_round_creation(
    session_factory, wallet_link, visit_id
):
    wallet_link.down = True
    async with session_factory() as session:
        with pytest.raises(RuntimeError, match="balance_check_failed"):
            await rps.create_round(visit_id, ALICE_ID, session)


async def test_wallet_down_mid_round_cancels_without_movement(
    client, session_factory, wallet_link, visit_id
):
    async with session_factory() as session:
        round_ = await rps.create_round(visit_id, ALICE_ID, session)
        await rps.submit_pick(visit_id, round_.round_id, ALICE_ID, "rock", session)

        wallet_link.down = True  # outage between the two picks
        final = await rps.submit_pick(
            visit_id, round_.round_id, BOB_ID, "scissors", session
        )

    assert final.status == "cancelled"
    assert final.cancel_reason == "wallet_unavailable"

    wallet_link.down = False
    assert await _balance(client, ALICE_ID) == 1000
    assert await _balance(client, BOB_ID) == 1000
    assert await _rps_ledger_rows(session_factory) == []
