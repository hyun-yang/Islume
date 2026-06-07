"""Bartering — async tool handlers.

Each handler is called by the worker AFTER policy_check returns auto_confirm
(or after the owner approves a pending tool_call). Handlers only return
side-effects (HandlerResult); the worker owns DB commit ordering and the
self-perpetuating queue.

Invariant: at most one IntentProposal with status='open' per session.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.intent_plugins.base import ChatEventSpec, HandlerResult
from shared.models import (
    Agent,
    IntentAgreement,
    IntentProposal,
    MatchSession,
)

PLUGIN_ID = "bartering"


async def _open_proposal(db: AsyncSession, session_id: UUID) -> IntentProposal | None:
    stmt = (
        select(IntentProposal)
        .where(IntentProposal.session_id == session_id, IntentProposal.status == "open")
        .order_by(IntentProposal.created_at.desc())
        .limit(1)
    )
    res = await db.execute(stmt)
    return res.scalar_one_or_none()


async def _supersede_open(db: AsyncSession, session_id: UUID, new_status: str) -> None:
    open_p = await _open_proposal(db, session_id)
    if open_p is not None:
        open_p.status = new_status


def _summary_for_event(tool_name: str, args: dict, currency: str) -> str:
    if tool_name == "propose_price":
        return f"proposed {args.get('amount')} {currency} for {args.get('item_name')}"
    if tool_name == "counter_offer":
        return f"counter-offered {args.get('amount')} {currency}"
    if tool_name == "accept_offer":
        return f"accepted at {args.get('amount')} {currency}"
    if tool_name == "reject_offer":
        return "rejected the open proposal"
    if tool_name == "share_reference":
        return f"shared {args.get('kind')}: {args.get('url')}"
    if tool_name == "withdraw":
        return "withdrew from the deal"
    return tool_name


async def handle_propose_price(
    *,
    db: AsyncSession,
    session: MatchSession,
    speaker: Agent,
    listener: Agent,
    args: dict,
    policy: dict,
    turn_number: int,
    tool_call_id: str,
    **_: Any,
) -> HandlerResult:
    # supersede any prior open proposal (the new one replaces it)
    await _supersede_open(db, session.id, new_status="superseded")
    proposal = IntentProposal(
        session_id=session.id,
        proposer_agent_id=speaker.id,
        turn_number=turn_number,
        plugin=PLUGIN_ID,
        proposal_type="propose_price",
        payload={
            "amount": args["amount"],
            "currency": args.get("currency", policy.get("currency", "ISL")),
            "item_name": args.get("item_name", policy.get("item_name", "")),
            "terms": args.get("terms"),
        },
        status="open",
    )
    db.add(proposal)
    await db.flush()
    event = ChatEventSpec(
        event_type="tool_call",
        payload={
            "tool_call_id": tool_call_id,
            "plugin": PLUGIN_ID,
            "tool_name": "propose_price",
            "agent_id": str(speaker.id),
            "status": "auto_confirmed",
            "arguments": dict(args),
            "proposal_id": str(proposal.id),
            "summary": _summary_for_event(
                "propose_price", args, policy.get("currency", "ISL")
            ),
        },
    )
    return HandlerResult(
        side_effects=[f"intent_proposals#{proposal.id} created (open)"],
        chat_events=[event],
    )


async def handle_counter_offer(
    *,
    db: AsyncSession,
    session: MatchSession,
    speaker: Agent,
    listener: Agent,
    args: dict,
    policy: dict,
    turn_number: int,
    tool_call_id: str,
    **_: Any,
) -> HandlerResult:
    # if no open proposal exists, counter_offer behaves like propose_price
    open_p = await _open_proposal(db, session.id)
    if open_p is None:
        # treat as new proposal
        return await handle_propose_price(
            db=db,
            session=session,
            speaker=speaker,
            listener=listener,
            args={
                "amount": args["amount"],
                "currency": policy.get("currency", "ISL"),
                "item_name": policy.get("item_name", ""),
                "terms": args.get("terms"),
            },
            policy=policy,
            turn_number=turn_number,
            tool_call_id=tool_call_id,
        )
    open_p.status = "countered"
    new_p = IntentProposal(
        session_id=session.id,
        proposer_agent_id=speaker.id,
        turn_number=turn_number,
        plugin=PLUGIN_ID,
        proposal_type="counter_offer",
        payload={
            "amount": args["amount"],
            "currency": policy.get("currency", "ISL"),
            "item_name": policy.get("item_name", ""),
            "terms": args.get("terms"),
            "counters_proposal_id": str(open_p.id),
        },
        status="open",
    )
    db.add(new_p)
    await db.flush()
    event = ChatEventSpec(
        event_type="tool_call",
        payload={
            "tool_call_id": tool_call_id,
            "plugin": PLUGIN_ID,
            "tool_name": "counter_offer",
            "agent_id": str(speaker.id),
            "status": "auto_confirmed",
            "arguments": dict(args),
            "proposal_id": str(new_p.id),
            "counters_proposal_id": str(open_p.id),
            "summary": _summary_for_event(
                "counter_offer", args, policy.get("currency", "ISL")
            ),
        },
    )
    return HandlerResult(
        side_effects=[
            f"intent_proposals#{open_p.id} → countered",
            f"intent_proposals#{new_p.id} created (open)",
        ],
        chat_events=[event],
    )


async def handle_accept_offer(
    *,
    db: AsyncSession,
    session: MatchSession,
    speaker: Agent,
    listener: Agent,
    args: dict,
    policy: dict,
    turn_number: int,
    tool_call_id: str,
    **_: Any,
) -> HandlerResult:
    open_p = await _open_proposal(db, session.id)
    if open_p is None:
        # No proposal to accept — log and continue
        event = ChatEventSpec(
            event_type="tool_call",
            payload={
                "tool_call_id": tool_call_id,
                "plugin": PLUGIN_ID,
                "tool_name": "accept_offer",
                "agent_id": str(speaker.id),
                "status": "auto_rejected",
                "arguments": dict(args),
                "summary": "tried to accept but no open proposal exists",
            },
        )
        return HandlerResult(
            side_effects=["no open proposal to accept; ignored"],
            chat_events=[event],
        )
    # Verify amount matches the open proposal
    proposed = (open_p.payload or {}).get("amount")
    if proposed != args.get("amount"):
        event = ChatEventSpec(
            event_type="tool_call",
            payload={
                "tool_call_id": tool_call_id,
                "plugin": PLUGIN_ID,
                "tool_name": "accept_offer",
                "agent_id": str(speaker.id),
                "status": "auto_rejected",
                "arguments": dict(args),
                "proposal_id": str(open_p.id),
                "summary": f"accept amount {args.get('amount')} does not match proposal amount {proposed}",
            },
        )
        return HandlerResult(
            side_effects=[
                f"accept amount mismatch (expected {proposed}, got {args.get('amount')})"
            ],
            chat_events=[event],
        )
    agreement = IntentAgreement(
        session_id=session.id,
        proposal_id=open_p.id,
        accepting_agent_id=speaker.id,
        finalized=False,
    )
    db.add(agreement)
    open_p.status = "accepted"
    # Check whether the other side also has an acceptance on this proposal
    other_stmt = select(IntentAgreement).where(
        IntentAgreement.session_id == session.id,
        IntentAgreement.proposal_id == open_p.id,
        IntentAgreement.accepting_agent_id != speaker.id,
    )
    res = await db.execute(other_stmt)
    other = res.scalar_one_or_none()
    finalized = other is not None
    if finalized:
        agreement.finalized = True
        other.finalized = True
        session.deal_status = "agreed"

    events: list[ChatEventSpec] = [
        ChatEventSpec(
            event_type="tool_call",
            payload={
                "tool_call_id": tool_call_id,
                "plugin": PLUGIN_ID,
                "tool_name": "accept_offer",
                "agent_id": str(speaker.id),
                "status": "auto_confirmed",
                "arguments": dict(args),
                "proposal_id": str(open_p.id),
                "summary": _summary_for_event(
                    "accept_offer", args, policy.get("currency", "ISL")
                ),
            },
        )
    ]
    if finalized:
        events.append(
            ChatEventSpec(
                event_type="deal_finalized",
                payload={
                    "plugin": PLUGIN_ID,
                    "proposal_id": str(open_p.id),
                    "amount": proposed,
                    "currency": (open_p.payload or {}).get("currency"),
                    "item_name": (open_p.payload or {}).get("item_name"),
                    "summary": f"Deal finalized at {proposed} {(open_p.payload or {}).get('currency')}",
                },
            )
        )
    return HandlerResult(
        side_effects=[
            f"intent_agreements created for proposal {open_p.id} (finalized={finalized})"
        ],
        chat_events=events,
        end_session=finalized,
    )


async def handle_reject_offer(
    *,
    db: AsyncSession,
    session: MatchSession,
    speaker: Agent,
    listener: Agent,
    args: dict,
    policy: dict,
    turn_number: int,
    tool_call_id: str,
    **_: Any,
) -> HandlerResult:
    open_p = await _open_proposal(db, session.id)
    if open_p is not None:
        open_p.status = "rejected"
        side = [f"intent_proposals#{open_p.id} → rejected"]
        proposal_id: str | None = str(open_p.id)
    else:
        side = ["no open proposal to reject; noop"]
        proposal_id = None
    event = ChatEventSpec(
        event_type="tool_call",
        payload={
            "tool_call_id": tool_call_id,
            "plugin": PLUGIN_ID,
            "tool_name": "reject_offer",
            "agent_id": str(speaker.id),
            "status": "auto_confirmed",
            "arguments": dict(args),
            "proposal_id": proposal_id,
            "summary": _summary_for_event(
                "reject_offer", args, policy.get("currency", "ISL")
            ),
        },
    )
    return HandlerResult(side_effects=side, chat_events=[event])


async def handle_share_reference(
    *,
    db: AsyncSession,
    session: MatchSession,
    speaker: Agent,
    listener: Agent,
    args: dict,
    policy: dict,
    turn_number: int,
    tool_call_id: str,
    **_: Any,
) -> HandlerResult:
    entry = {
        "kind": args["kind"],
        "url": args["url"],
        "label": args.get("label"),
        "agent_id": str(speaker.id),
    }
    refs = list(session.shared_references or [])
    refs.append(entry)
    session.shared_references = refs
    event = ChatEventSpec(
        event_type="tool_call",
        payload={
            "tool_call_id": tool_call_id,
            "plugin": PLUGIN_ID,
            "tool_name": "share_reference",
            "agent_id": str(speaker.id),
            "status": "auto_confirmed",
            "arguments": dict(args),
            "summary": _summary_for_event(
                "share_reference", args, policy.get("currency", "ISL")
            ),
        },
    )
    return HandlerResult(
        side_effects=[f"match_sessions.shared_references appended ({len(refs)} total)"],
        chat_events=[event],
    )


async def handle_withdraw(
    *,
    db: AsyncSession,
    session: MatchSession,
    speaker: Agent,
    listener: Agent,
    args: dict,
    policy: dict,
    turn_number: int,
    tool_call_id: str,
    **_: Any,
) -> HandlerResult:
    open_p = await _open_proposal(db, session.id)
    if open_p is not None:
        open_p.status = "withdrawn"
    event = ChatEventSpec(
        event_type="tool_call",
        payload={
            "tool_call_id": tool_call_id,
            "plugin": PLUGIN_ID,
            "tool_name": "withdraw",
            "agent_id": str(speaker.id),
            "status": "auto_confirmed",
            "arguments": dict(args),
            "summary": _summary_for_event(
                "withdraw", args, policy.get("currency", "ISL")
            ),
        },
    )
    return HandlerResult(
        side_effects=[
            f"intent_proposals#{open_p.id} → withdrawn"
            if open_p
            else "no open proposal"
        ],
        chat_events=[event],
    )


HANDLERS = {
    "propose_price": handle_propose_price,
    "counter_offer": handle_counter_offer,
    "accept_offer": handle_accept_offer,
    "reject_offer": handle_reject_offer,
    "share_reference": handle_share_reference,
    "withdraw": handle_withdraw,
}
