"""End-to-end bartering test.

Wires Alice (seller) + Bob (buyer) with the bartering plugin attached, creates a
match session, and watches the session stream until:

  - both sides exchange tool_calls (propose_price / counter_offer / accept_offer),
  - a `deal_finalized` event lands, OR
  - the session pauses on awaiting_owner_confirmation (we then POST /respond and
    expect the conversation to resume).

Run AFTER `./scripts/start_all.sh` (DB + 6 services up). The script attaches the
plugins itself by writing to agents.attached_plugins — so it's idempotent and
seed-data doesn't need to ship bartering presets.
"""
from __future__ import annotations

import asyncio
import json
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.db import get_sessionmaker
from shared.messages import ChatEvent, session_stream
from shared.models import (
    Agent,
    IntentAgreement,
    IntentProposal,
    MatchSession,
    ToolCallEvent,
    UserAgent,
)
from shared.redis_client import close_redis, get_redis

ORCHESTRATOR_URL = "http://localhost:8003"
USER_A = UUID("00000001-0000-0000-0000-000000000000")  # Alice (seller)
USER_B = UUID("00000002-0000-0000-0000-000000000000")  # Bob (buyer)

SELLER_POLICY = {
    "role": "seller",
    "item_name": "vintage Polaroid camera",
    "currency": "ISL",
    "price_range": {"min": 30, "max": 60},
    "auto_accept_at_or_above": 55,
    "auto_reject_below": 20,
    "max_rounds": 6,
}
BUYER_POLICY = {
    "role": "buyer",
    "item_name": "vintage Polaroid camera",
    "currency": "ISL",
    "price_range": {"min": 25, "max": 55},
    "auto_accept_at_or_above": 40,
    "auto_reject_below": 15,
    "max_rounds": 6,
}
MATCH_CONTEXT = (
    "Alice is selling a vintage Polaroid camera. Bob has been hunting for one. "
    "They've just met — they should negotiate a price and try to close the deal."
)
MAX_TURNS = 8


async def _attach_plugin(
    db: AsyncSession, user_id: UUID, policy: dict
) -> Agent:
    ua_stmt = (
        select(UserAgent)
        .where(UserAgent.user_id == user_id, UserAgent.is_active.is_(True))
        .limit(1)
    )
    ua = (await db.execute(ua_stmt)).scalar_one_or_none()
    if ua is None:
        raise SystemExit(f"User {user_id} has no active agent — run seed_db.py first")
    agent = await db.get(Agent, ua.agent_id)
    if agent is None:
        raise SystemExit(f"Agent {ua.agent_id} missing")
    agent.attached_plugins = [{"plugin": "bartering", "policy": policy}]
    return agent


async def _detach_plugin(db: AsyncSession, user_id: UUID) -> None:
    ua_stmt = (
        select(UserAgent)
        .where(UserAgent.user_id == user_id, UserAgent.is_active.is_(True))
        .limit(1)
    )
    ua = (await db.execute(ua_stmt)).scalar_one_or_none()
    if ua is None:
        return
    agent = await db.get(Agent, ua.agent_id)
    if agent is not None:
        agent.attached_plugins = None


async def _watch_session(
    session_id: UUID, max_events: int = 50, idle_timeout_s: float = 60.0
) -> list[dict]:
    """Consume the session stream until session_ended or a long idle gap.

    Returns the list of parsed events for assertions.
    """
    r = get_redis()
    key = session_stream(session_id)
    last_id = "0-0"
    events: list[dict] = []
    while len(events) < max_events:
        resp = await r.xread(
            streams={key: last_id}, block=int(idle_timeout_s * 1000), count=10
        )
        if not resp:
            break
        for _stream, entries in resp:
            for entry_id, data in entries:
                last_id = entry_id
                ev = ChatEvent.from_redis(data)
                snapshot = {
                    "event_type": ev.event_type,
                    "turn_number": ev.turn_number,
                    "content": ev.content,
                }
                if ev.event_type == "tool_call" and ev.content:
                    try:
                        snapshot["payload"] = json.loads(ev.content)
                    except json.JSONDecodeError:
                        pass
                events.append(snapshot)
                if ev.event_type == "session_ended":
                    return events
    return events


async def _create_session(client: httpx.AsyncClient) -> UUID:
    payload = {
        "user_a_id": str(USER_A),
        "user_b_id": str(USER_B),
        "similarity_score": 0.5,
        "match_context": MATCH_CONTEXT,
        "max_turns": MAX_TURNS,
    }
    resp = await client.post(f"{ORCHESTRATOR_URL}/sessions", json=payload)
    resp.raise_for_status()
    return UUID(resp.json()["session_id"])


async def _resolve_pending(
    client: httpx.AsyncClient,
    session_id: UUID,
    audit: ToolCallEvent,
    action: str,
) -> dict:
    body = {"user_id": str(audit.user_id), "action": action}
    resp = await client.post(
        f"{ORCHESTRATOR_URL}/sessions/{session_id}/tool-calls/{audit.id}/respond",
        json=body,
    )
    resp.raise_for_status()
    return resp.json()


async def main() -> None:
    sessionmaker = get_sessionmaker()
    # Attach plugins
    async with sessionmaker() as db:
        await _attach_plugin(db, USER_A, SELLER_POLICY)
        await _attach_plugin(db, USER_B, BUYER_POLICY)
        await db.commit()

    async with httpx.AsyncClient(timeout=30.0) as client:
        session_id = await _create_session(client)
        print(f"Created bartering session: {session_id}")

        events = await _watch_session(session_id)
        print(f"\nCollected {len(events)} events:")
        for e in events:
            tn = e.get("turn_number")
            t = e["event_type"]
            if t == "turn":
                snippet = (e.get("content") or "")[:80].replace("\n", " ")
                print(f"  turn {tn}: {snippet}")
            elif t == "tool_call":
                p = e.get("payload") or {}
                print(
                    f"  tool_call {tn}: {p.get('tool_name')} ({p.get('status')}) "
                    f"args={p.get('arguments')}"
                )
            elif t == "deal_finalized":
                p = e.get("payload") or {}
                print(f"  *** DEAL FINALIZED: {p}")
            else:
                print(f"  {t} turn={tn}")

        # If session paused on pending, resolve and continue.
        async with sessionmaker() as db:
            sess = await db.get(MatchSession, session_id)
            if sess and sess.status == "awaiting_owner_confirmation":
                pend_stmt = (
                    select(ToolCallEvent)
                    .where(
                        ToolCallEvent.session_id == session_id,
                        ToolCallEvent.status == "pending",
                    )
                    .order_by(ToolCallEvent.created_at.desc())
                )
                pendings = list((await db.execute(pend_stmt)).scalars())
                for audit in pendings:
                    print(
                        f"  resolving pending {audit.tool_name}({audit.arguments}) → approve"
                    )
                    await _resolve_pending(client, session_id, audit, "approve")
                more = await _watch_session(session_id, max_events=30)
                for e in more:
                    print("  resumed:", e["event_type"], e.get("turn_number"))
                events.extend(more)

        # Assertions
        async with sessionmaker() as db:
            session = await db.get(MatchSession, session_id)
            props = list(
                (
                    await db.execute(
                        select(IntentProposal).where(
                            IntentProposal.session_id == session_id
                        )
                    )
                ).scalars()
            )
            agrees = list(
                (
                    await db.execute(
                        select(IntentAgreement).where(
                            IntentAgreement.session_id == session_id
                        )
                    )
                ).scalars()
            )
            tcs = list(
                (
                    await db.execute(
                        select(ToolCallEvent).where(
                            ToolCallEvent.session_id == session_id
                        )
                    )
                ).scalars()
            )

        print("\n--- DB state ---")
        print(f"session.status = {session.status}, deal_status = {session.deal_status}")
        print(f"intent_proposals: {len(props)} rows")
        for p in props:
            print(
                f"  {p.id} type={p.proposal_type} status={p.status} "
                f"amount={(p.payload or {}).get('amount')}"
            )
        print(f"intent_agreements: {len(agrees)} (finalized={[a.finalized for a in agrees]})")
        print(f"tool_call_events: {len(tcs)} (statuses={[t.status for t in tcs]})")

        ok = (
            len(props) >= 1
            and any(t.status in ("auto_confirmed", "user_confirmed") for t in tcs)
        )
        print("\nRESULT:", "PASS ✓" if ok else "FAIL ✗")

    # Detach plugins so subsequent runs of run_orchestrator_e2e.py see no plugins.
    async with sessionmaker() as db:
        await _detach_plugin(db, USER_A)
        await _detach_plugin(db, USER_B)
        await db.commit()

    await close_redis()


if __name__ == "__main__":
    asyncio.run(main())
