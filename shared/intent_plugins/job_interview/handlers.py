"""Job interview — async tool handlers.

Called by the orchestrator after the owner approves a pending tool_call
(request/accept are always pending) or by the worker for auto-confirmed
declines. Handlers only return side-effects (HandlerResult); the worker /
orchestrator own DB commit ordering and the self-perpetuating queue.

Invariant: at most one IntentProposal (proposal_type="interview_request")
with status='open' per session.
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

PLUGIN_ID = "job_interview"


async def _open_request(db: AsyncSession, session_id: UUID) -> IntentProposal | None:
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


async def handle_request_interview(
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
    # A new request supersedes any prior open one.
    prior = await _open_request(db, session.id)
    if prior is not None:
        prior.status = "superseded"
    position = args.get("position") or policy.get("position")
    proposal = IntentProposal(
        session_id=session.id,
        proposer_agent_id=speaker.id,
        turn_number=turn_number,
        plugin=PLUGIN_ID,
        proposal_type="interview_request",
        payload={
            "message": args.get("message"),
            "position": position,
            "company": policy.get("company"),
        },
        status="open",
    )
    db.add(proposal)
    await db.flush()
    summary = "requested an interview" + (f" for {position}" if position else "")
    return HandlerResult(
        side_effects=[f"intent_proposals#{proposal.id} created (open)"],
        chat_events=[
            _tool_call_event(
                tool_call_id,
                "request_interview",
                speaker,
                args,
                "auto_confirmed",
                summary,
                proposal.id,
            )
        ],
    )


async def handle_accept_interview(
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
    open_req = await _open_request(db, session.id)
    if open_req is None:
        return HandlerResult(
            side_effects=["no open interview request to accept; ignored"],
            chat_events=[
                _tool_call_event(
                    tool_call_id,
                    "accept_interview",
                    speaker,
                    args,
                    "auto_rejected",
                    "tried to accept but no open interview request exists",
                )
            ],
        )
    if open_req.proposer_agent_id == speaker.id:
        return HandlerResult(
            side_effects=["agent tried to accept its own interview request; ignored"],
            chat_events=[
                _tool_call_event(
                    tool_call_id,
                    "accept_interview",
                    speaker,
                    args,
                    "auto_rejected",
                    "cannot accept your own interview request",
                    open_req.id,
                )
            ],
        )
    # Request + acceptance = both sides committed; finalize immediately
    # (unlike bartering, there is no amount to mirror-accept).
    agreement = IntentAgreement(
        session_id=session.id,
        proposal_id=open_req.id,
        accepting_agent_id=speaker.id,
        finalized=True,
    )
    db.add(agreement)
    open_req.status = "accepted"
    position = (open_req.payload or {}).get("position")
    agreed_summary = "Interview agreed" + (f" for {position}" if position else "")
    return HandlerResult(
        side_effects=[f"intent_agreements created for proposal#{open_req.id} (finalized)"],
        chat_events=[
            _tool_call_event(
                tool_call_id,
                "accept_interview",
                speaker,
                args,
                "auto_confirmed",
                "accepted the interview request",
                open_req.id,
            ),
            ChatEventSpec(
                event_type="deal_finalized",
                payload={
                    "plugin": PLUGIN_ID,
                    "proposal_id": str(open_req.id),
                    "summary": agreed_summary,
                },
            ),
        ],
    )


async def handle_decline_interview(
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
    open_req = await _open_request(db, session.id)
    if open_req is None:
        return HandlerResult(
            side_effects=["no open interview request to decline; ignored"],
            chat_events=[
                _tool_call_event(
                    tool_call_id,
                    "decline_interview",
                    speaker,
                    args,
                    "auto_rejected",
                    "tried to decline but no open interview request exists",
                )
            ],
        )
    open_req.status = "rejected"
    return HandlerResult(
        side_effects=[f"intent_proposals#{open_req.id} rejected"],
        chat_events=[
            _tool_call_event(
                tool_call_id,
                "decline_interview",
                speaker,
                args,
                "auto_confirmed",
                "declined the interview request",
                open_req.id,
            )
        ],
    )


HANDLERS = {
    "request_interview": handle_request_interview,
    "accept_interview": handle_accept_interview,
    "decline_interview": handle_decline_interview,
}
