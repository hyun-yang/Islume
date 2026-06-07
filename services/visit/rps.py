"""Server-authoritative Rock-Paper-Scissors round logic.

A round lives entirely in Redis as a Hash (`rps:round:{round_id}`) with a 60s
TTL. Both players submit their pick to this service; once both picks are in,
the server resolves the outcome, calls the wallet transfer for the loser→winner
exchange, and broadcasts a `rps:reveal` event to both users' notification
streams.

The active round per visit is gated by a Redis SET key
(`visit:rps:active:{visit_id}`) so a visit cannot have two concurrent rounds.
"""
from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

import httpx
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from services.visit.user_events import publish_user_event
from shared.config import get_settings
from shared.models import User, VisitSession
from shared.redis_client import get_redis

WAGER_AMOUNT = 10
ROUND_TTL_SECONDS = 60
HANDS = {"rock", "paper", "scissors"}


def round_key(round_id: UUID) -> str:
    return f"rps:round:{round_id}"


def active_round_key(visit_id: UUID) -> str:
    return f"visit:rps:active:{visit_id}"


# ---- Request/response schemas ----------------------------------------------

class CreateRpsRoundRequest(BaseModel):
    initiator_id: UUID


class SubmitRpsPickRequest(BaseModel):
    sender_id: UUID
    pick: str  # rock | paper | scissors


class DeclineRpsRequest(BaseModel):
    sender_id: UUID


class RpsRoundResponse(BaseModel):
    round_id: UUID
    visit_id: UUID
    visitor_id: UUID
    host_id: UUID
    wager_amount: int
    visitor_pick: str | None
    host_pick: str | None
    status: str  # pending | revealed | cancelled
    outcome: str | None  # win | lose | draw — from visitor's perspective
    winner_id: UUID | None
    cancel_reason: str | None
    created_at: str
    revealed_at: str | None


# ---- Internal helpers ------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _resolve(visitor_pick: str, host_pick: str) -> str:
    """Return outcome from visitor's perspective."""
    if visitor_pick == host_pick:
        return "draw"
    wins_against = {"rock": "scissors", "paper": "rock", "scissors": "paper"}
    return "win" if wins_against[visitor_pick] == host_pick else "lose"


def _hash_to_response(round_id: UUID, h: dict[str, str]) -> RpsRoundResponse:
    return RpsRoundResponse(
        round_id=round_id,
        visit_id=UUID(h["visit_id"]),
        visitor_id=UUID(h["visitor_id"]),
        host_id=UUID(h["host_id"]),
        wager_amount=int(h["wager_amount"]),
        visitor_pick=h.get("visitor_pick") or None,
        host_pick=h.get("host_pick") or None,
        status=h["status"],
        outcome=h.get("outcome") or None,
        winner_id=UUID(h["winner_id"]) if h.get("winner_id") else None,
        cancel_reason=h.get("cancel_reason") or None,
        created_at=h["created_at"],
        revealed_at=h.get("revealed_at") or None,
    )


async def _fetch_balance(user_id: UUID) -> int:
    settings = get_settings()
    url = f"{settings.wallet_service_url}/wallets/{user_id}/balance"
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return int(resp.json()["balance"])


async def _transfer(
    from_user_id: UUID,
    to_user_id: UUID,
    amount: int,
    metadata: dict[str, object],
) -> tuple[bool, str | None]:
    settings = get_settings()
    url = f"{settings.wallet_service_url}/transactions/transfer"
    payload = {
        "from_user_id": str(from_user_id),
        "to_user_id": str(to_user_id),
        "amount": amount,
        "tx_type": "rps_bet",
        "metadata": metadata,
    }
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.post(url, json=payload)
        if resp.status_code == 200 or resp.status_code == 201:
            return True, None
        try:
            detail = resp.json().get("detail", f"HTTP {resp.status_code}")
        except Exception:
            detail = f"HTTP {resp.status_code}"
        return False, str(detail)


async def _publish_round(
    visitor_id: UUID, host_id: UUID, event_type: str, data: dict[str, object]
) -> None:
    """Send the same event to both users' notification streams."""
    await publish_user_event(visitor_id, event_type, data)
    await publish_user_event(host_id, event_type, data)


# ---- Public operations -----------------------------------------------------


async def create_round(
    visit_id: UUID, initiator_id: UUID, db: AsyncSession
) -> RpsRoundResponse:
    visit = await db.get(VisitSession, visit_id)
    if visit is None:
        raise ValueError("visit_not_found")
    if initiator_id not in (visit.visitor_id, visit.host_id):
        raise PermissionError("initiator_not_in_visit")

    r = get_redis()

    # One active round per visit.
    existing = await r.get(active_round_key(visit_id))
    if existing is not None:
        raise RuntimeError("active_round_exists")

    # Balance check on both sides.
    try:
        visitor_bal = await _fetch_balance(visit.visitor_id)
        host_bal = await _fetch_balance(visit.host_id)
    except httpx.HTTPError as e:
        raise RuntimeError(f"balance_check_failed: {e}") from e
    if visitor_bal < WAGER_AMOUNT:
        raise ValueError("visitor_insufficient_balance")
    if host_bal < WAGER_AMOUNT:
        raise ValueError("host_insufficient_balance")

    visitor = await db.get(User, visit.visitor_id)
    host = await db.get(User, visit.host_id)
    visitor_name = visitor.display_name if visitor else ""
    host_name = host.display_name if host else ""

    round_id = uuid4()
    now = _now_iso()
    fields = {
        "visit_id": str(visit_id),
        "visitor_id": str(visit.visitor_id),
        "host_id": str(visit.host_id),
        "wager_amount": str(WAGER_AMOUNT),
        "status": "pending",
        "created_at": now,
    }
    await r.hset(round_key(round_id), mapping=fields)
    await r.expire(round_key(round_id), ROUND_TTL_SECONDS)
    await r.set(active_round_key(visit_id), str(round_id), ex=ROUND_TTL_SECONDS)

    await _publish_round(
        visit.visitor_id,
        visit.host_id,
        "rps:invite",
        {
            "visit_id": str(visit_id),
            "round_id": str(round_id),
            "wager_amount": WAGER_AMOUNT,
            "initiator_id": str(initiator_id),
            "visitor_id": str(visit.visitor_id),
            "host_id": str(visit.host_id),
            "visitor_name": visitor_name,
            "host_name": host_name,
        },
    )

    h = await r.hgetall(round_key(round_id))
    return _hash_to_response(round_id, h)


async def submit_pick(
    visit_id: UUID, round_id: UUID, sender_id: UUID, pick: str, db: AsyncSession
) -> RpsRoundResponse:
    if pick not in HANDS:
        raise ValueError("invalid_pick")

    visit = await db.get(VisitSession, visit_id)
    if visit is None:
        raise ValueError("visit_not_found")
    if sender_id not in (visit.visitor_id, visit.host_id):
        raise PermissionError("sender_not_in_visit")

    r = get_redis()
    h = await r.hgetall(round_key(round_id))
    if not h:
        raise ValueError("round_not_found_or_expired")
    if h["status"] != "pending":
        raise RuntimeError(f"round_already_{h['status']}")
    if str(visit.id) != h["visit_id"]:
        raise ValueError("round_visit_mismatch")

    pick_field = "visitor_pick" if sender_id == visit.visitor_id else "host_pick"
    if h.get(pick_field):
        # Same user trying to pick twice.
        raise RuntimeError("already_picked")

    await r.hset(round_key(round_id), pick_field, pick)
    h[pick_field] = pick

    if h.get("visitor_pick") and h.get("host_pick"):
        # Both arrived → resolve.
        outcome = _resolve(h["visitor_pick"], h["host_pick"])
        winner_id: UUID | None = None
        loser_id: UUID | None = None
        if outcome == "win":
            winner_id, loser_id = visit.visitor_id, visit.host_id
        elif outcome == "lose":
            winner_id, loser_id = visit.host_id, visit.visitor_id

        balance_after_visitor: int | None = None
        balance_after_host: int | None = None
        if winner_id is not None and loser_id is not None:
            ok, reason = await _transfer(
                from_user_id=loser_id,
                to_user_id=winner_id,
                amount=WAGER_AMOUNT,
                metadata={
                    "visit_id": str(visit_id),
                    "round_id": str(round_id),
                    "visitor_pick": h["visitor_pick"],
                    "host_pick": h["host_pick"],
                },
            )
            if not ok:
                # Cancel: do not mutate balances.
                await r.hset(
                    round_key(round_id),
                    mapping={
                        "status": "cancelled",
                        "cancel_reason": reason or "transfer_failed",
                    },
                )
                await r.delete(active_round_key(visit_id))
                await _publish_round(
                    visit.visitor_id,
                    visit.host_id,
                    "rps:cancelled",
                    {
                        "visit_id": str(visit_id),
                        "round_id": str(round_id),
                        "reason": reason or "transfer_failed",
                    },
                )
                final = await r.hgetall(round_key(round_id))
                return _hash_to_response(round_id, final)
            try:
                balance_after_visitor = await _fetch_balance(visit.visitor_id)
                balance_after_host = await _fetch_balance(visit.host_id)
            except httpx.HTTPError:
                balance_after_visitor = None
                balance_after_host = None

        await r.hset(
            round_key(round_id),
            mapping={
                "status": "revealed",
                "outcome": outcome,
                "winner_id": str(winner_id) if winner_id else "",
                "revealed_at": _now_iso(),
            },
        )
        await r.delete(active_round_key(visit_id))

        reveal_data: dict[str, object] = {
            "visit_id": str(visit_id),
            "round_id": str(round_id),
            "visitor_pick": h["visitor_pick"],
            "host_pick": h["host_pick"],
            "outcome": outcome,
        }
        if winner_id is not None:
            reveal_data["winner_id"] = str(winner_id)
        # Each side gets its own post-transfer balance.
        if balance_after_visitor is not None:
            await publish_user_event(
                visit.visitor_id,
                "rps:reveal",
                {**reveal_data, "balance_after": balance_after_visitor},
            )
        else:
            await publish_user_event(visit.visitor_id, "rps:reveal", reveal_data)
        if balance_after_host is not None:
            await publish_user_event(
                visit.host_id,
                "rps:reveal",
                {**reveal_data, "balance_after": balance_after_host},
            )
        else:
            await publish_user_event(visit.host_id, "rps:reveal", reveal_data)

    final = await r.hgetall(round_key(round_id))
    return _hash_to_response(round_id, final)


async def decline_round(
    visit_id: UUID, round_id: UUID, sender_id: UUID, db: AsyncSession
) -> RpsRoundResponse:
    visit = await db.get(VisitSession, visit_id)
    if visit is None:
        raise ValueError("visit_not_found")
    if sender_id not in (visit.visitor_id, visit.host_id):
        raise PermissionError("sender_not_in_visit")

    r = get_redis()
    h = await r.hgetall(round_key(round_id))
    if not h:
        raise ValueError("round_not_found_or_expired")
    if h["status"] != "pending":
        # Already resolved or cancelled — return current state without changes.
        return _hash_to_response(round_id, h)

    await r.hset(
        round_key(round_id),
        mapping={"status": "cancelled", "cancel_reason": "declined"},
    )
    await r.delete(active_round_key(visit_id))
    await _publish_round(
        visit.visitor_id,
        visit.host_id,
        "rps:cancelled",
        {
            "visit_id": str(visit_id),
            "round_id": str(round_id),
            "reason": "declined",
            "cancelled_by": str(sender_id),
        },
    )

    final = await r.hgetall(round_key(round_id))
    return _hash_to_response(round_id, final)


async def get_round(round_id: UUID) -> RpsRoundResponse:
    r = get_redis()
    h = await r.hgetall(round_key(round_id))
    if not h:
        raise ValueError("round_not_found_or_expired")
    return _hash_to_response(round_id, h)
