"""Agent orchestrator: receives match events, creates sessions, enqueues tasks."""

import asyncio
import json
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.db import get_sessionmaker
from shared.intent_plugins import (
    PLUGINS,
    ChatEventSpec,
    get_plugin,
)
from shared.messages import (
    STREAM_LLM_TASKS,
    ChatEvent,
    TurnTask,
    session_stream,
)
from shared.models import (
    Agent,
    ConversationTurn,
    MatchSession,
    Notification,
    ToolCallEvent,
    User,
    UserAgent,
)
from shared.notifications import add_notification
from shared.redis_client import close_redis, get_redis

# How long a pending owner-confirmation lives before the sweeper expires it.
PENDING_CONFIRMATION_TTL = timedelta(minutes=60)
# Sweeper poll interval.
PENDING_SWEEPER_INTERVAL_S = 60.0


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure consumer group exists on startup
    from shared.messages import CONSUMER_GROUP

    r = get_redis()
    try:
        await r.xgroup_create(STREAM_LLM_TASKS, CONSUMER_GROUP, id="0", mkstream=True)
    except Exception as e:
        if "BUSYGROUP" not in str(e):
            raise
    sweeper = asyncio.create_task(_pending_confirmation_sweeper())
    try:
        yield
    finally:
        sweeper.cancel()
        try:
            await sweeper
        except (asyncio.CancelledError, Exception):
            pass
        await close_redis()


app = FastAPI(title="Islume Orchestrator", lifespan=lifespan)


async def get_session() -> AsyncSession:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        yield session


class SessionSummary(BaseModel):
    session_id: UUID
    partner_user_id: UUID
    partner_name: str
    partner_agent_name: str
    my_agent_name: str
    status: str
    turn_count: int
    max_turns: int
    similarity_score: float
    started_at: str


@app.get("/users/{user_id}/sessions", response_model=list[SessionSummary])
async def list_user_sessions(
    user_id: UUID,
    db: AsyncSession = Depends(get_session),
):
    """List all sessions a user participates in (as user_a or user_b)."""
    stmt = (
        select(MatchSession)
        .where(
            or_(MatchSession.user_a_id == user_id, MatchSession.user_b_id == user_id)
        )
        .order_by(MatchSession.started_at.desc())
    )
    result = await db.execute(stmt)
    sessions = list(result.scalars())
    if not sessions:
        return []

    # Collect all user/agent IDs to load names in bulk
    user_ids = set()
    agent_ids = set()
    for s in sessions:
        user_ids.update([s.user_a_id, s.user_b_id])
        agent_ids.update([s.agent_a_id, s.agent_b_id])

    user_stmt = select(User.id, User.display_name).where(User.id.in_(user_ids))
    user_result = await db.execute(user_stmt)
    user_names = dict(user_result.all())

    agent_stmt = select(Agent.id, Agent.name).where(Agent.id.in_(agent_ids))
    agent_result = await db.execute(agent_stmt)
    agent_names = dict(agent_result.all())

    summaries = []
    for s in sessions:
        is_a = s.user_a_id == user_id
        partner_uid = s.user_b_id if is_a else s.user_a_id
        partner_agent_id = s.agent_b_id if is_a else s.agent_a_id
        my_agent_id = s.agent_a_id if is_a else s.agent_b_id
        summaries.append(
            SessionSummary(
                session_id=s.id,
                partner_user_id=partner_uid,
                partner_name=user_names.get(partner_uid, "Unknown"),
                partner_agent_name=agent_names.get(partner_agent_id, "Unknown"),
                my_agent_name=agent_names.get(my_agent_id, "Unknown"),
                status=s.status,
                turn_count=s.turn_count,
                max_turns=s.max_turns,
                similarity_score=s.similarity_score,
                started_at=s.started_at.isoformat(),
            )
        )
    return summaries


class NotificationItem(BaseModel):
    id: UUID
    type: str
    session_id: UUID | None
    payload: dict
    read_at: str | None
    created_at: str


@app.get("/users/{user_id}/notifications", response_model=list[NotificationItem])
async def list_notifications(
    user_id: UUID,
    unread_only: bool = False,
    limit: int = 50,
    db: AsyncSession = Depends(get_session),
):
    """Return a user's durable notifications, newest first.

    The Redis user stream is live-only; this is the inbox a user checks for
    anything that happened while they were away.
    """
    stmt = (
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
        .limit(min(limit, 200))
    )
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    rows = list((await db.execute(stmt)).scalars())
    return [
        NotificationItem(
            id=n.id,
            type=n.type,
            session_id=n.session_id,
            payload=n.payload or {},
            read_at=n.read_at.isoformat() if n.read_at else None,
            created_at=n.created_at.isoformat(),
        )
        for n in rows
    ]


class MarkReadRequest(BaseModel):
    ids: list[UUID] | None = None
    all: bool = False


@app.post("/users/{user_id}/notifications/mark-read")
async def mark_notifications_read(
    user_id: UUID,
    body: MarkReadRequest,
    db: AsyncSession = Depends(get_session),
):
    """Mark the given notification ids (or all unread) as read."""
    if not body.all and not body.ids:
        raise HTTPException(status_code=422, detail="Provide ids or all=true")
    stmt = (
        select(Notification)
        .where(Notification.user_id == user_id)
        .where(Notification.read_at.is_(None))
    )
    if not body.all:
        stmt = stmt.where(Notification.id.in_(body.ids or []))
    rows = list((await db.execute(stmt)).scalars())
    now = datetime.utcnow()
    for n in rows:
        n.read_at = now
    await db.commit()
    return {"status": "ok", "marked": len(rows)}


class TurnResponse(BaseModel):
    turn_number: int
    speaker_agent_id: UUID
    speaker_name: str
    content: str
    model_used: str | None = None


@app.get("/sessions/{session_id}/turns", response_model=list[TurnResponse])
async def list_session_turns(
    session_id: UUID,
    db: AsyncSession = Depends(get_session),
):
    """Return a session's conversation turns from Postgres, ordered by turn number.

    Postgres is the durable source of truth for "what already happened"; the
    session WS stream (`stream:session:{id}`) is ephemeral and can be cleared
    between runs, which would otherwise leave a finished conversation unviewable.
    The frontend loads history from here and uses the WS only for live updates —
    the same REST-then-WS pattern as direct chat.
    """
    session_obj = await db.get(MatchSession, session_id)
    if session_obj is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # speaker_name is "{owner display} ({agent name})" — the same shape the worker
    # writes to the stream, so REST history and live WS turns render identically.
    # Built from the session's two (user, agent) pairs; no agent→owner lookup needed.
    user_stmt = select(User.id, User.display_name).where(
        User.id.in_([session_obj.user_a_id, session_obj.user_b_id])
    )
    user_names = dict((await db.execute(user_stmt)).all())
    agent_stmt = select(Agent.id, Agent.name).where(
        Agent.id.in_([session_obj.agent_a_id, session_obj.agent_b_id])
    )
    agent_names = dict((await db.execute(agent_stmt)).all())

    def _speaker(agent_id: UUID, user_id: UUID) -> str:
        return f"{user_names.get(user_id, 'Unknown')} ({agent_names.get(agent_id, 'Unknown')})"

    speaker_by_agent = {
        session_obj.agent_a_id: _speaker(session_obj.agent_a_id, session_obj.user_a_id),
        session_obj.agent_b_id: _speaker(session_obj.agent_b_id, session_obj.user_b_id),
    }

    turns_stmt = (
        select(ConversationTurn)
        .where(ConversationTurn.session_id == session_id)
        .order_by(ConversationTurn.turn_number)
    )
    turns = list((await db.execute(turns_stmt)).scalars())
    return [
        TurnResponse(
            turn_number=t.turn_number,
            speaker_agent_id=t.agent_id,
            speaker_name=speaker_by_agent.get(t.agent_id, "Unknown"),
            content=t.content,
            model_used=t.model_used,
        )
        for t in turns
    ]


class CreateSessionRequest(BaseModel):
    user_a_id: UUID
    user_b_id: UUID
    similarity_score: float
    match_context: str = ""
    max_turns: int = 6


class CreateSessionResponse(BaseModel):
    session_id: UUID
    status: str


@app.get("/health")
async def health():
    return {"status": "ok", "service": "orchestrator"}


@app.post("/sessions", response_model=CreateSessionResponse)
async def create_session(
    body: CreateSessionRequest,
    db: AsyncSession = Depends(get_session),
):
    """Create a new conversation session and enqueue the first turn."""
    # Look up active agents for both users
    agent_a = await _get_active_agent(db, body.user_a_id)
    agent_b = await _get_active_agent(db, body.user_b_id)
    if agent_a is None or agent_b is None:
        raise HTTPException(
            status_code=400,
            detail="Both users must have an active agent.",
        )

    # Create the session record
    session_obj = MatchSession(
        user_a_id=body.user_a_id,
        user_b_id=body.user_b_id,
        agent_a_id=agent_a.id,
        agent_b_id=agent_b.id,
        similarity_score=body.similarity_score,
        match_context=body.match_context,
        max_turns=body.max_turns,
        status="active",
    )
    db.add(session_obj)
    await db.commit()
    await db.refresh(session_obj)

    # Enqueue the opening turn (agent A speaks first)
    task = TurnTask(
        session_id=session_obj.id,
        turn_number=1,
        speaker_agent_id=agent_a.id,
        listener_agent_id=agent_b.id,
        is_opening=True,
    )
    r = get_redis()
    await r.xadd(STREAM_LLM_TASKS, task.to_redis())

    return CreateSessionResponse(session_id=session_obj.id, status="active")


class AffinityResponseRequest(BaseModel):
    user_id: UUID
    action: str  # "continue" or "end"


@app.post("/sessions/{session_id}/affinity-response")
async def affinity_response(
    session_id: UUID,
    body: AffinityResponseRequest,
    db: AsyncSession = Depends(get_session),
):
    """Handle a user's response to an affinity check."""
    session_obj = await db.get(MatchSession, session_id)
    if session_obj is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session_obj.status != "awaiting_review":
        raise HTTPException(status_code=409, detail="Session not awaiting review")

    if body.action not in ("continue", "end"):
        raise HTTPException(
            status_code=422, detail="action must be 'continue' or 'end'"
        )

    # Record this user's response
    if body.user_id == session_obj.user_a_id:
        session_obj.user_a_affinity_response = body.action
    elif body.user_id == session_obj.user_b_id:
        session_obj.user_b_affinity_response = body.action
    else:
        raise HTTPException(status_code=403, detail="User not in this session")

    # Check if either user chose "end"
    responses = [
        session_obj.user_a_affinity_response,
        session_obj.user_b_affinity_response,
    ]
    if "end" in responses:
        session_obj.status = "ended_by_user"
        await db.commit()

        from shared.messages import ChatEvent, session_stream

        r = get_redis()
        end_event = ChatEvent(event_type="session_ended", session_id=session_id)
        await r.xadd(session_stream(session_id), end_event.to_redis())

        return {"status": "ended", "reason": "user_declined"}

    # Check if both users responded "continue"
    if all(r == "continue" for r in responses):
        session_obj.status = "active"
        await db.commit()

        # Resume the conversation — enqueue next turn
        r = get_redis()
        next_task = TurnTask(
            session_id=session_id,
            turn_number=session_obj.turn_count + 1,
            speaker_agent_id=session_obj.agent_a_id,
            listener_agent_id=session_obj.agent_b_id,
            is_opening=False,
        )
        await r.xadd(STREAM_LLM_TASKS, next_task.to_redis())

        return {"status": "resumed"}

    # Only one user has responded so far
    await db.commit()
    return {"status": "waiting", "detail": "Waiting for other user"}


class CancelSessionRequest(BaseModel):
    user_id: UUID


@app.post("/sessions/{session_id}/cancel")
async def cancel_session(
    session_id: UUID,
    body: CancelSessionRequest,
    db: AsyncSession = Depends(get_session),
):
    """Cancel an in-progress conversation. Only a participant may cancel.

    Each session is one specific partner pairing, so cancelling by session_id
    cancels exactly that conversation — a user with several concurrent chats
    can drop one without touching the others.

    Sets status="cancelled"; the self-perpetuating worker loop then halts on
    its own because `_run_turn` skips any session whose status != "active"
    (an already-queued next turn is dropped without enqueueing another). A
    `session_ended` event closes any connected viewers. No coordinator needed.
    """
    session_obj = await db.get(MatchSession, session_id)
    if session_obj is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if body.user_id not in (session_obj.user_a_id, session_obj.user_b_id):
        raise HTTPException(status_code=403, detail="User not in this session")

    # Terminal states are idempotent — report the existing status, don't error.
    if session_obj.status in ("completed", "ended_by_user", "cancelled"):
        return {"status": session_obj.status, "detail": "already ended"}

    session_obj.status = "cancelled"
    session_obj.ended_at = datetime.utcnow()
    await db.commit()

    r = get_redis()
    end_event = ChatEvent(event_type="session_ended", session_id=session_id)
    await r.xadd(session_stream(session_id), end_event.to_redis())
    return {"status": "cancelled"}


# ---------------------------------------------------------------------------
# Intent plugin endpoints
# ---------------------------------------------------------------------------


class PluginInfo(BaseModel):
    id: str
    card_kind: str
    description: str
    tool_names: list[str]
    policy_schema: dict


@app.get("/plugins", response_model=list[PluginInfo])
async def list_plugins():
    """Return metadata for every registered intent plugin (used by the frontend
    AgentPlugins picker to render policy forms)."""
    return [
        PluginInfo(
            id=p.id,
            card_kind=p.card_kind,
            description=p.description,
            tool_names=[t.name for t in p.tools],
            policy_schema=p.policy_schema,
        )
        for p in PLUGINS.values()
    ]


class ToolCallRespondRequest(BaseModel):
    user_id: UUID
    action: str  # "approve" or "reject"


@app.post("/sessions/{session_id}/tool-calls/{tool_call_id}/respond")
async def tool_call_respond(
    session_id: UUID,
    tool_call_id: UUID,
    body: ToolCallRespondRequest,
    db: AsyncSession = Depends(get_session),
):
    """Owner confirms or rejects a pending tool_call.

    On approve: re-run the plugin handler with the same args + policy, publish
    `tool_call (user_confirmed)` and any handler ChatEvents on the session stream,
    set session.status back to "active" (or "completed" if the handler ends it),
    and enqueue the next turn.

    On reject: mark the row user_rejected, publish a `tool_call (user_rejected)`
    event, set status="active", enqueue the next turn so the partner can react.
    """
    if body.action not in ("approve", "reject"):
        raise HTTPException(
            status_code=422, detail="action must be 'approve' or 'reject'"
        )

    audit = await db.get(ToolCallEvent, tool_call_id)
    if audit is None or audit.session_id != session_id:
        raise HTTPException(
            status_code=404, detail="Tool call not found for this session"
        )
    if audit.user_id != body.user_id:
        raise HTTPException(
            status_code=403, detail="User not the owner of this tool call"
        )
    if audit.status != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Tool call status is {audit.status}, expected pending",
        )

    session_obj = await db.get(MatchSession, session_id)
    if session_obj is None:
        raise HTTPException(status_code=404, detail="Session not found")

    plugin = get_plugin(audit.plugin)
    if plugin is None:
        raise HTTPException(
            status_code=500, detail=f"plugin {audit.plugin} not registered"
        )

    # Load both agents — we need the speaker (whose owner is confirming) plus
    # the listener so the handler can build its ChatEvent payload.
    agents_stmt = select(Agent).where(
        Agent.id.in_([session_obj.agent_a_id, session_obj.agent_b_id])
    )
    agents_result = await db.execute(agents_stmt)
    agents = {a.id: a for a in agents_result.scalars()}
    speaker = agents.get(audit.agent_id)
    if speaker is None:
        raise HTTPException(status_code=500, detail="Speaker agent missing")
    listener_id = (
        session_obj.agent_b_id
        if audit.agent_id == session_obj.agent_a_id
        else session_obj.agent_a_id
    )
    listener = agents[listener_id]
    # Owner policy lives on the speaker's attached_plugins entry.
    policy = _find_policy(speaker, audit.plugin)

    chat_events: list[ChatEventSpec] = []
    end_session_now = False
    next_speaker_id = listener_id  # default: other side responds

    if body.action == "approve":
        handler = plugin.handlers.get(audit.tool_name)
        if handler is None:
            audit.status = "auto_rejected"
            audit.policy_reason = "no handler registered"
            audit.resolved_at = datetime.utcnow()
            chat_events.append(
                ChatEventSpec(
                    event_type="tool_call",
                    payload={
                        "tool_call_id": str(audit.id),
                        "plugin": audit.plugin,
                        "tool_name": audit.tool_name,
                        "status": "auto_rejected",
                        "arguments": audit.arguments,
                        "agent_id": str(speaker.id),
                        "reason": "no handler",
                    },
                )
            )
        else:
            try:
                result = await handler(
                    db=db,
                    session=session_obj,
                    speaker=speaker,
                    listener=listener,
                    args=audit.arguments,
                    policy=policy,
                    turn_number=audit.turn_number,
                    tool_call_id=str(audit.id),
                )
            except Exception as e:
                audit.status = "auto_rejected"
                audit.policy_reason = f"handler error after confirmation: {e}"
                audit.resolved_at = datetime.utcnow()
                chat_events.append(
                    ChatEventSpec(
                        event_type="tool_call",
                        payload={
                            "tool_call_id": str(audit.id),
                            "plugin": audit.plugin,
                            "tool_name": audit.tool_name,
                            "status": "auto_rejected",
                            "arguments": audit.arguments,
                            "agent_id": str(speaker.id),
                            "reason": f"handler error: {e}",
                        },
                    )
                )
            else:
                audit.status = "user_confirmed"
                audit.resolved_at = datetime.utcnow()
                # Override the handler's default "auto_confirmed" status in the
                # ChatEvent payload so the client sees it surfaced as
                # user_confirmed (matches the audit row).
                for spec in result.chat_events:
                    if spec.event_type == "tool_call" and spec.payload.get(
                        "tool_call_id"
                    ) == str(audit.id):
                        spec.payload["status"] = "user_confirmed"
                chat_events.extend(result.chat_events)
                end_session_now = result.end_session
    else:  # reject
        audit.status = "user_rejected"
        audit.resolved_at = datetime.utcnow()
        chat_events.append(
            ChatEventSpec(
                event_type="tool_call",
                payload={
                    "tool_call_id": str(audit.id),
                    "plugin": audit.plugin,
                    "tool_name": audit.tool_name,
                    "status": "user_rejected",
                    "arguments": audit.arguments,
                    "agent_id": str(speaker.id),
                },
            )
        )

    if end_session_now:
        session_obj.status = "completed"
    else:
        session_obj.status = "active"

    await db.commit()

    # ----- publish events (commit-then-stream invariant) -------------------
    r = get_redis()
    for spec in chat_events:
        ev = ChatEvent(
            event_type=spec.event_type,
            session_id=session_id,
            turn_number=audit.turn_number,
            content=json.dumps(spec.payload),
        )
        await r.xadd(session_stream(session_id), ev.to_redis())

    if session_obj.status == "completed":
        end_event = ChatEvent(event_type="session_ended", session_id=session_id)
        await r.xadd(session_stream(session_id), end_event.to_redis())
        return {"status": "completed"}

    # Resume: enqueue the next turn — partner becomes the speaker.
    next_task = TurnTask(
        session_id=session_id,
        turn_number=audit.turn_number + 1,
        speaker_agent_id=next_speaker_id,
        listener_agent_id=speaker.id,
        is_opening=False,
    )
    await r.xadd(STREAM_LLM_TASKS, next_task.to_redis())
    return {"status": "resumed", "action": body.action}


def _find_policy(speaker: Agent, plugin_id: str) -> dict:
    for entry in speaker.attached_plugins or []:
        if isinstance(entry, dict) and entry.get("plugin") == plugin_id:
            return entry.get("policy") or {}
    return {}


async def _pending_confirmation_sweeper() -> None:
    """Periodically expire pending tool_call rows older than the TTL.

    Single-process sweeper; advisory locks across instances are out-of-scope
    for MVP since only one orchestrator runs. When expired, mark the row,
    publish a tool_call (expired) event, and resume the session by enqueueing
    the next turn (partner reacts to the expiry).
    """
    sessionmaker = get_sessionmaker()
    while True:
        try:
            await asyncio.sleep(PENDING_SWEEPER_INTERVAL_S)
            cutoff = datetime.utcnow() - PENDING_CONFIRMATION_TTL
            async with sessionmaker() as db:
                stmt = (
                    select(ToolCallEvent)
                    .where(ToolCallEvent.status == "pending")
                    .where(ToolCallEvent.created_at < cutoff)
                )
                expired = list((await db.execute(stmt)).scalars())
                for audit in expired:
                    audit.status = "expired"
                    audit.resolved_at = datetime.utcnow()
                    # Inbox row in the same transaction (commit-before-publish).
                    add_notification(
                        db,
                        user_id=audit.user_id,
                        type="deal:expired",
                        session_id=audit.session_id,
                        payload={
                            "tool_call_id": str(audit.id),
                            "plugin": audit.plugin,
                            "tool_name": audit.tool_name,
                        },
                    )
                if not expired:
                    await db.commit()
                    continue
                # Resume each session whose pending action expired.
                session_ids = {a.session_id for a in expired}
                sessions_stmt = select(MatchSession).where(
                    MatchSession.id.in_(session_ids)
                )
                sessions = {
                    s.id: s for s in (await db.execute(sessions_stmt)).scalars()
                }
                for s in sessions.values():
                    if s.status == "awaiting_owner_confirmation":
                        s.status = "active"
                await db.commit()

                r = get_redis()
                # Group expired-by-session for ordered publishes.
                from collections import defaultdict

                by_session: dict[UUID, list[ToolCallEvent]] = defaultdict(list)
                for a in expired:
                    by_session[a.session_id].append(a)
                for sid, audits in by_session.items():
                    for a in audits:
                        ev = ChatEvent(
                            event_type="tool_call",
                            session_id=sid,
                            turn_number=a.turn_number,
                            content=json.dumps(
                                {
                                    "tool_call_id": str(a.id),
                                    "plugin": a.plugin,
                                    "tool_name": a.tool_name,
                                    "status": "expired",
                                    "arguments": a.arguments,
                                    "agent_id": str(a.agent_id),
                                }
                            ),
                        )
                        await r.xadd(session_stream(sid), ev.to_redis())
                    # Re-enqueue: partner reacts.
                    s = sessions.get(sid)
                    if s and s.status == "active":
                        speaker_id = audits[0].agent_id
                        listener_id = (
                            s.agent_b_id if speaker_id == s.agent_a_id else s.agent_a_id
                        )
                        next_task = TurnTask(
                            session_id=sid,
                            turn_number=audits[-1].turn_number + 1,
                            speaker_agent_id=listener_id,
                            listener_agent_id=speaker_id,
                            is_opening=False,
                        )
                        await r.xadd(STREAM_LLM_TASKS, next_task.to_redis())
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[pending_sweeper] error: {e}")
            await asyncio.sleep(5)


async def _get_active_agent(db: AsyncSession, user_id: UUID) -> Agent | None:
    stmt = (
        select(Agent)
        .join(UserAgent, UserAgent.agent_id == Agent.id)
        .where(UserAgent.user_id == user_id, UserAgent.is_active.is_(True))
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()
