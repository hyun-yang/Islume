"""Fan-out e2e test: one user's active agent vs N partners, concurrently.

Creates N MatchSessions in parallel (Alice -> Bob, Carol, David, ...) and polls
Postgres until every session reaches status='completed' with turn_count == max_turns.

Run AFTER starting services (./scripts/start_all.sh) and seeding (scripts/seed_db.py).
"""
import argparse
import asyncio
import time
from uuid import UUID

import httpx
from sqlalchemy import select

from shared.db import get_sessionmaker
from shared.models import ConversationTurn, MatchSession, User

ORCHESTRATOR_URL = "http://localhost:8003"
ALICE = UUID("00000001-0000-0000-0000-000000000000")
POLL_INTERVAL_S = 2.0


def seed_uuid(n: int) -> UUID:
    return UUID(f"{n:08d}-0000-0000-0000-000000000000")


async def create_session(
    client: httpx.AsyncClient, partner_uuid: UUID, max_turns: int
) -> UUID:
    payload = {
        "user_a_id": str(ALICE),
        "user_b_id": str(partner_uuid),
        "similarity_score": 0.5,
        "match_context": "fanout-e2e",
        "max_turns": max_turns,
    }
    resp = await client.post(f"{ORCHESTRATOR_URL}/sessions", json=payload)
    resp.raise_for_status()
    return UUID(resp.json()["session_id"])


async def fetch_user_names(sessionmaker, user_ids: list[UUID]) -> dict[UUID, str]:
    async with sessionmaker() as db:
        stmt = select(User.id, User.display_name).where(User.id.in_(user_ids))
        return dict((await db.execute(stmt)).all())


async def fetch_session_status(
    sessionmaker, session_ids: list[UUID]
) -> dict[UUID, tuple[str, int, int]]:
    async with sessionmaker() as db:
        stmt = select(MatchSession).where(MatchSession.id.in_(session_ids))
        rows = (await db.execute(stmt)).scalars().all()
    return {r.id: (r.status, r.turn_count, r.max_turns) for r in rows}


async def count_turns_per_session(
    sessionmaker, session_ids: list[UUID]
) -> dict[UUID, int]:
    async with sessionmaker() as db:
        result: dict[UUID, int] = {}
        for sid in session_ids:
            stmt = select(ConversationTurn).where(ConversationTurn.session_id == sid)
            rows = (await db.execute(stmt)).scalars().all()
            result[sid] = len(rows)
        return result


def format_status_line(
    elapsed: float, session_ids: list[UUID], statuses: dict[UUID, tuple[str, int, int]]
) -> str:
    parts = []
    for sid in session_ids:
        status, count, mt = statuses.get(sid, ("missing", 0, 0))
        parts.append(f"{str(sid)[:4]} {status} {count}/{mt}")
    return f"[t={elapsed:5.1f}s] " + " | ".join(parts)


async def main(args: argparse.Namespace) -> int:
    print("Prereq: services running (./scripts/start_all.sh) & seed_db.py executed.")
    print()

    partners = [seed_uuid(i) for i in range(2, 2 + args.partner_count)]
    sessionmaker = get_sessionmaker()

    user_names = await fetch_user_names(sessionmaker, [ALICE] + partners)
    alice_name = user_names.get(ALICE, "Alice")
    partner_label = ", ".join(user_names.get(p, str(p)[:8]) for p in partners)
    print(f"Creating {args.partner_count} sessions concurrently:")
    print(f"  {alice_name} -> {partner_label}")
    print(f"  max_turns={args.max_turns}, timeout={args.timeout}s")
    print()

    start = time.monotonic()
    async with httpx.AsyncClient(timeout=30.0) as client:
        session_ids = await asyncio.gather(
            *(create_session(client, p, args.max_turns) for p in partners)
        )

    session_to_partner = dict(zip(session_ids, partners, strict=True))
    print("Created session_ids:")
    for sid, p in zip(session_ids, partners, strict=True):
        print(f"  {sid}  (partner: {user_names.get(p, '?')})")
    print()

    deadline = start + args.timeout
    last_line = ""
    while time.monotonic() < deadline:
        statuses = await fetch_session_status(sessionmaker, session_ids)
        elapsed = time.monotonic() - start

        line = format_status_line(elapsed, session_ids, statuses)
        if line != last_line:
            print(line)
            last_line = line

        all_completed = all(
            statuses.get(sid, ("?",))[0] == "completed" for sid in session_ids
        )
        if all_completed:
            break

        awaiting = [
            sid
            for sid in session_ids
            if statuses.get(sid, ("?",))[0] == "awaiting_review"
        ]
        if awaiting:
            print()
            print("FAIL: affinity_check triggered before max_turns reached.")
            print("      Affected sessions:", [str(s)[:8] for s in awaiting])
            print(
                "      Hint: raise max_turns or check User.affinity_check_turns / agent_md v2 check_turns."
            )
            return 1

        await asyncio.sleep(POLL_INTERVAL_S)

    final_statuses = await fetch_session_status(sessionmaker, session_ids)
    turn_counts = await count_turns_per_session(sessionmaker, session_ids)
    elapsed = time.monotonic() - start

    completed = [
        sid
        for sid in session_ids
        if final_statuses.get(sid, ("?",))[0] == "completed"
        and turn_counts.get(sid, 0) == args.max_turns
    ]

    print()
    header = f"{len(completed)}/{len(session_ids)} sessions completed in {elapsed:.1f}s"
    if len(completed) == len(session_ids):
        print(f"PASS: {header}")
    else:
        print(f"FAIL: {header}")

    for sid in session_ids:
        status, db_turn_count, _ = final_statuses.get(sid, ("missing", 0, 0))
        actual_turns = turn_counts.get(sid, 0)
        ok = status == "completed" and actual_turns == args.max_turns
        mark = "OK" if ok else "FAIL"
        partner_name = user_names.get(session_to_partner[sid], "?")
        print(
            f"  [{mark}] {sid}  {alice_name}->{partner_name}  "
            f"status={status} turns={actual_turns}/{args.max_turns} "
            f"(MatchSession.turn_count={db_turn_count})"
        )

    return 0 if len(completed) == len(session_ids) else 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--partner-count",
        type=int,
        default=3,
        help="Number of partner users (seed users #2..#N+1). Max 19. Default: 3.",
    )
    parser.add_argument(
        "--max-turns",
        type=int,
        default=6,
        help="max_turns per session. Default: 6.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=300,
        help="Total polling timeout in seconds. Default: 300.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(parse_args())))
