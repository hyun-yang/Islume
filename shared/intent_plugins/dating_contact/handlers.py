"""Dating — async tool handlers.

propose/accept/share run via the orchestrator's owner-approval path (their
policy checks are always pending); decline auto-confirms in the worker.
Handlers only return side-effects (HandlerResult); the worker / orchestrator
own commit ordering and the queue.

Invariant: at most one IntentProposal (proposal_type="offline_meeting")
with status='open' per session.

share_contact's handler runs ONLY after the owner approved, so its ChatEvent
payload may carry the real channel/handle — that event IS the delivery.
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

PLUGIN_ID = "dating_contact"


async def _open_meeting(db: AsyncSession, session_id: UUID) -> IntentProposal | None:
    stmt = (
        select(IntentProposal)
        .where(
            IntentProposal.session_id == session_id,
            IntentProposal.plugin == PLUGIN_ID,
            IntentProposal.status == "open",
        )
        .order_by(IntentProposal.created_at.desc())
        .limit(1)
    )
    res = await db.execute(stmt)
    return res.scalar_one_or_none()


def _tool_call_event(
    tool_call_id: str,
    tool_name: str,
    speaker: Agent,
    args: dict,
    status: str,
    summary: str,
    proposal_id: UUID | None = None,
) -> ChatEventSpec:
    payload: dict = {
        "tool_call_id": tool_call_id,
        "plugin": PLUGIN_ID,
        "tool_name": tool_name,
        "agent_id": str(speaker.id),
        "status": status,
        "arguments": dict(args),
        "summary": summary,
    }
    if proposal_id is not None:
        payload["proposal_id"] = str(proposal_id)
    return ChatEventSpec(event_type="tool_call", payload=payload)


async def handle_propose_offline_meeting(
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
    prior = await _open_meeting(db, session.id)
    if prior is not None:
        prior.status = "superseded"
    proposal = IntentProposal(
        session_id=session.id,
        proposer_agent_id=speaker.id,
        turn_number=turn_number,
        plugin=PLUGIN_ID,
        proposal_type="offline_meeting",
        payload={
            "place_hint": args.get("place_hint"),
            "time_hint": args.get("time_hint"),
            "message": args.get("message"),
        },
        status="open",
    )
    db.add(proposal)
    await db.flush()
    hint = args.get("place_hint") or args.get("time_hint")
    summary = "proposed meeting offline" + (f" ({hint})" if hint else "")
    return HandlerResult(
        side_effects=[f"intent_proposals#{proposal.id} created (open)"],
        chat_events=[
            _tool_call_event(
                tool_call_id,
                "propose_offline_meeting",
                speaker,
                args,
                "auto_confirmed",
                summary,
                proposal.id,
            )
        ],
    )


async def handle_accept_offline_meeting(
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
    open_p = await _open_meeting(db, session.id)
    if open_p is None:
        return HandlerResult(
            side_effects=["no open offline-meeting proposal to accept; ignored"],
            chat_events=[
                _tool_call_event(
                    tool_call_id,
                    "accept_offline_meeting",
                    speaker,
                    args,
                    "auto_rejected",
                    "tried to accept but no open offline-meeting proposal exists",
                )
            ],
        )
    if open_p.proposer_agent_id == speaker.id:
        return HandlerResult(
            side_effects=["agent tried to accept its own proposal; ignored"],
            chat_events=[
                _tool_call_event(
                    tool_call_id,
                    "accept_offline_meeting",
                    speaker,
                    args,
                    "auto_rejected",
                    "cannot accept your own offline-meeting proposal",
                    open_p.id,
                )
            ],
        )
    agreement = IntentAgreement(
        session_id=session.id,
        proposal_id=open_p.id,
        accepting_agent_id=speaker.id,
        finalized=True,
    )
    db.add(agreement)
    open_p.status = "accepted"
    return HandlerResult(
        side_effects=[f"intent_agreements created for proposal#{open_p.id} (finalized)"],
        chat_events=[
            _tool_call_event(
                tool_call_id,
                "accept_offline_meeting",
                speaker,
                args,
                "auto_confirmed",
                "accepted the offline meeting",
                open_p.id,
            ),
            ChatEventSpec(
                event_type="deal_finalized",
                payload={
                    "plugin": PLUGIN_ID,
                    "proposal_id": str(open_p.id),
                    "summary": "Offline meeting agreed",
                },
            ),
        ],
    )


async def handle_decline_offline_meeting(
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
    open_p = await _open_meeting(db, session.id)
    if open_p is None:
        return HandlerResult(
            side_effects=["no open offline-meeting proposal to decline; ignored"],
            chat_events=[
                _tool_call_event(
                    tool_call_id,
                    "decline_offline_meeting",
                    speaker,
                    args,
                    "auto_rejected",
                    "tried to decline but no open offline-meeting proposal exists",
                )
            ],
        )
    open_p.status = "rejected"
    return HandlerResult(
        side_effects=[f"intent_proposals#{open_p.id} rejected"],
        chat_events=[
            _tool_call_event(
                tool_call_id,
                "decline_offline_meeting",
                speaker,
                args,
                "auto_confirmed",
                "declined the offline meeting",
                open_p.id,
            )
        ],
    )


async def handle_share_contact(
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
    # Runs only post-approval: this event delivers the real handle.
    channel = args.get("channel", "other")
    return HandlerResult(
        side_effects=[f"contact shared via {channel}"],
        chat_events=[
            _tool_call_event(
                tool_call_id,
                "share_contact",
                speaker,
                args,
                "auto_confirmed",
                f"shared contact ({channel})",
            )
        ],
    )


HANDLERS = {
    "propose_offline_meeting": handle_propose_offline_meeting,
    "accept_offline_meeting": handle_accept_offline_meeting,
    "decline_offline_meeting": handle_decline_offline_meeting,
    "share_contact": handle_share_contact,
}
