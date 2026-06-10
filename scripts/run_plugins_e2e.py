"""End-to-end test for all three intent plugins.

Runs one match session per plugin (bartering, dating_contact, job_interview)
between Alice and Bob, with scenario policies attached to their active agents:

  - bartering        — price negotiation; expects an IntentProposal and a
                       confirmed tool call (auto or owner-approved).
  - dating_contact   — offline-meeting proposal + contact sharing; every
                       meaningful tool is owner-gated, so the script approves
                       pendings as they appear. share_contact args must be
                       {"redacted": true} on the shared session stream.
  - job_interview    — recruiter requests an interview, job seeker accepts;
                       both sides are owner-gated.

Usage (AFTER ./scripts/start_all.sh — DB + 6 services up):

  uv run python scripts/run_plugins_e2e.py                  # all three
  uv run python scripts/run_plugins_e2e.py dating_contact   # just one
  uv run python scripts/run_plugins_e2e.py bartering job_interview

Like run_bartering_e2e.py, plugins are attached by writing to
agents.attached_plugins directly; the agents' previous attachments are
saved and restored afterwards, so the script is idempotent.
"""
from __future__ import annotations

import asyncio
import json
import sys
from dataclasses import dataclass, field
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
USER_A = UUID("00000001-0000-0000-0000-000000000000")  # Alice
USER_B = UUID("00000002-0000-0000-0000-000000000000")  # Bob

MAX_TURNS = 8
MAX_APPROVE_ROUNDS = 6  # pending → approve → resume cycles per scenario


@dataclass
class Scenario:
    plugin: str
    policy_a: dict
    policy_b: dict
    match_context: str
    tool_names: set[str]
    # tools whose stream payloads must show {"redacted": true} pre-approval
    redacted_tools: set[str] = field(default_factory=set)


SCENARIOS: dict[str, Scenario] = {
    "bartering": Scenario(
        plugin="bartering",
        policy_a={
            "role": "seller",
            "item_name": "vintage Polaroid camera",
            "currency": "ISL",
            "price_range": {"min": 30, "max": 60},
            "auto_accept_at_or_above": 55,
            "auto_reject_below": 20,
            "max_rounds": 6,
        },
        policy_b={
            "role": "buyer",
            "item_name": "vintage Polaroid camera",
            "currency": "ISL",
            "price_range": {"min": 25, "max": 55},
            "auto_accept_at_or_above": 40,
            "auto_reject_below": 15,
            "max_rounds": 6,
        },
        match_context=(
            "Alice is selling a vintage Polaroid camera. Bob has been hunting "
            "for one. They've just met — they should negotiate a price and try "
            "to close the deal."
        ),
        tool_names={
            "propose_price",
            "counter_offer",
            "accept_offer",
            "reject_offer",
            "share_reference",
            "withdraw",
        },
    ),
    "dating_contact": Scenario(
        plugin="dating_contact",
        policy_a={"allowed_channels": ["instagram", "kakao"]},
        policy_b={},
        match_context=(
            "Alice and Bob matched and the chemistry is great — shared taste "
            "in music, easy banter. They genuinely like each other. They "
            "should propose meeting offline (a record store café) and exchange "
            "contact info using their tools."
        ),
        tool_names={
            "propose_offline_meeting",
            "accept_offline_meeting",
            "decline_offline_meeting",
            "share_contact",
        },
        redacted_tools={"share_contact"},
    ),
    "job_interview": Scenario(
        plugin="job_interview",
        policy_a={
            "role": "recruiter",
            "position": "Backend Engineer",
            "company": "Islume Labs",
        },
        policy_b={"role": "job_seeker"},
        match_context=(
            "Alice is a recruiter at Islume Labs hiring a Backend Engineer. "
            "Bob is actively job hunting and his background fits well. Alice "
            "should request an interview with her tool; Bob should accept "
            "with his."
        ),
        tool_names={"request_interview", "accept_interview", "decline_interview"},
    ),
}


async def _active_agent(db: AsyncSession, user_id: UUID) -> Agent:
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
    return agent


async def _attach(
    db: AsyncSession, user_id: UUID, plugin: str, policy: dict
) -> list[dict] | None:
    """Attach the plugin to the user's active agent; return the previous value."""
    agent = await _active_agent(db, user_id)
    previous = agent.attached_plugins
    agent.attached_plugins = [{"plugin": plugin, "policy": policy}]
    return previous


async def _restore(
    db: AsyncSession, user_id: UUID, previous: list[dict] | None
) -> None:
    agent = await _active_agent(db, user_id)
    agent.attached_plugins = previous


async def _session_status(session_id: UUID) -> str | None:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        sess = await db.get(MatchSession, session_id)
        return sess.status if sess else None


async def _watch_session(
    session_id: UUID, last_id: str, max_events: int = 60, idle_rounds: int = 12
) -> tuple[list[dict], str, str]:
    """Consume the session stream until it ends, pauses, or goes idle.

    Polls in short blocks so an awaiting_owner_confirmation pause is noticed
    within seconds instead of a long fixed timeout. Returns
    (events, last_stream_id, stop_reason).
    """
    r = get_redis()
    key = session_stream(session_id)
    events: list[dict] = []
    idle = 0
    while len(events) < max_events:
        resp = await r.xread(streams={key: last_id}, block=10000, count=10)
        if not resp:
            idle += 1
            status = await _session_status(session_id)
            if status == "awaiting_owner_confirmation":
                return events, last_id, "pending_approval"
            if status in ("completed", "awaiting_review", "ended"):
                return events, last_id, status or "unknown"
            if idle >= idle_rounds:
                return events, last_id, "idle_timeout"
            continue
        idle = 0
        for _stream, entries in resp:
            for entry_id, data in entries:
                last_id = entry_id
                ev = ChatEvent.from_redis(data)
                snapshot: dict = {
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
                if ev.event_type in ("session_ended", "final_evaluation"):
                    return events, last_id, ev.event_type
    return events, last_id, "max_events"


def _print_events(events: list[dict]) -> None:
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
        else:
            print(f"  {t} turn={tn}")


async def _approve_pendings(
    client: httpx.AsyncClient, session_id: UUID
) -> int:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        pend_stmt = (
            select(ToolCallEvent)
            .where(
                ToolCallEvent.session_id == session_id,
                ToolCallEvent.status == "pending",
            )
            .order_by(ToolCallEvent.created_at)
        )
        pendings = list((await db.execute(pend_stmt)).scalars())
    for audit in pendings:
        print(f"  approving pending {audit.tool_name} (owner={audit.user_id})")
        resp = await client.post(
            f"{ORCHESTRATOR_URL}/sessions/{session_id}/tool-calls/{audit.id}/respond",
            json={"user_id": str(audit.user_id), "action": "approve"},
        )
        resp.raise_for_status()
    return len(pendings)


async def _run_scenario(client: httpx.AsyncClient, sc: Scenario) -> bool:
    print(f"\n{'=' * 60}\n[{sc.plugin}] starting scenario\n{'=' * 60}")
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as db:
        prev_a = await _attach(db, USER_A, sc.plugin, sc.policy_a)
        prev_b = await _attach(db, USER_B, sc.plugin, sc.policy_b)
        await db.commit()

    try:
        resp = await client.post(
            f"{ORCHESTRATOR_URL}/sessions",
            json={
                "user_a_id": str(USER_A),
                "user_b_id": str(USER_B),
                "similarity_score": 0.5,
                "match_context": sc.match_context,
                "max_turns": MAX_TURNS,
            },
        )
        resp.raise_for_status()
        session_id = UUID(resp.json()["session_id"])
        print(f"[{sc.plugin}] session: {session_id}")

        events: list[dict] = []
        last_id = "0-0"
        for _round in range(MAX_APPROVE_ROUNDS):
            batch, last_id, reason = await _watch_session(session_id, last_id)
            _print_events(batch)
            events.extend(batch)
            if reason == "pending_approval":
                approved = await _approve_pendings(client, session_id)
                if approved == 0:
                    print(f"[{sc.plugin}] paused but no pending rows — stopping")
                    break
            else:
                print(f"[{sc.plugin}] stream stopped: {reason}")
                break

        # --- DB state + assertions ---
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

        print(f"\n[{sc.plugin}] --- DB state ---")
        print(f"  session.status = {session.status if session else '?'}")
        print(f"  intent_proposals: {len(props)}")
        for p in props:
            print(f"    type={p.proposal_type} status={p.status}")
        print(f"  intent_agreements: {len(agrees)}")
        print(f"  tool_call_events: {[(t.tool_name, t.status) for t in tcs]}")

        plugin_calls = [t for t in tcs if t.tool_name in sc.tool_names]
        confirmed = [
            t
            for t in plugin_calls
            if t.status in ("auto_confirmed", "user_confirmed")
        ]
        checks: list[tuple[str, bool]] = [
            (f"≥1 {sc.plugin} tool call made", len(plugin_calls) >= 1),
            ("≥1 tool call confirmed (auto or owner)", len(confirmed) >= 1),
            ("≥1 intent proposal persisted", len(props) >= 1),
        ]
        # Redaction invariant: sensitive args never appear on the shared stream.
        stream_leaks = [
            e
            for e in events
            if e["event_type"] == "tool_call"
            and (e.get("payload") or {}).get("tool_name") in sc.redacted_tools
            and (e.get("payload") or {}).get("arguments") != {"redacted": True}
        ]
        if any(
            (e.get("payload") or {}).get("tool_name") in sc.redacted_tools
            for e in events
            if e["event_type"] == "tool_call"
        ):
            checks.append(("redacted tool args hidden on stream", not stream_leaks))

        ok = True
        for label, passed in checks:
            print(f"  [{'✓' if passed else '✗'}] {label}")
            ok = ok and passed
        print(f"[{sc.plugin}] RESULT: {'PASS ✓' if ok else 'FAIL ✗'}")
        return ok
    finally:
        async with sessionmaker() as db:
            await _restore(db, USER_A, prev_a)
            await _restore(db, USER_B, prev_b)
            await db.commit()


async def main() -> None:
    requested = sys.argv[1:] or list(SCENARIOS.keys())
    unknown = [p for p in requested if p not in SCENARIOS]
    if unknown:
        raise SystemExit(
            f"Unknown plugin(s): {unknown}. Choose from {list(SCENARIOS.keys())}"
        )

    results: dict[str, bool] = {}
    async with httpx.AsyncClient(timeout=30.0) as client:
        for plugin in requested:
            results[plugin] = await _run_scenario(client, SCENARIOS[plugin])

    print(f"\n{'=' * 60}\nSUMMARY\n{'=' * 60}")
    for plugin, ok in results.items():
        print(f"  {plugin}: {'PASS ✓' if ok else 'FAIL ✗'}")

    await close_redis()
    if not all(results.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
