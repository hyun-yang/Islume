"""LLM Worker: consumes turn tasks from Redis Streams, generates replies."""
import asyncio
import json as json_module
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Literal
from uuid import UUID

from opentelemetry import trace
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from services.visit.user_events import publish_user_event
from services.worker.evaluation import analyze_partner_evaluations
from shared.agent_md import (
    load_references,
    references_from_meta,
    select_references,
)
from shared.config import MAX_TOTAL_TURNS
from shared.db import get_sessionmaker
from shared.intent_plugins import (
    ChatEventSpec,
    Plugin,
    PolicyDecision,
    ToolDef,
    get_plugin,
    validate_arguments,
)
from shared.llm import (
    GenerationResult,
    LLMResponse,
    generate,
    get_default_model,
    get_system_model,
)
from shared.messages import (
    CONSUMER_GROUP,
    STREAM_LLM_TASKS,
    ChatEvent,
    TurnTask,
    session_stream,
)
from shared.models import (
    Agent,
    ConversationTurn,
    MatchSession,
    PartnerEvaluation,
    ToolCallEvent,
    User,
    UserAgent,
)
from shared.notifications import add_notification
from shared.redis_client import close_redis, get_redis
from shared.telemetry import get_tracer, init_telemetry

WORKER_NAME = f"worker-{os.getpid()}"
BLOCK_MS = 5000

# Project-root agents/ — references live at
# {AGENTS_DIR}/{user_uuid}/{slug}/references/{name}.md
AGENTS_DIR = Path(__file__).resolve().parents[2] / "agents"
# Per-turn cap on how many chars of reference content to inject (~600 tokens)
REFERENCES_CHAR_BUDGET = 2400


def _v2_safety_block(safety: dict | None) -> str:
    if not safety:
        return ""
    lines = ["IMPORTANT — non-negotiable safety rules:"]
    if safety.get("refuse_personal_info_share"):
        lines.append("- Refuse if asked for the owner's real name, address, phone, or other personal contact info.")
    redlines = safety.get("redline_topics") or []
    if redlines:
        lines.append(
            "- Never engage with these topics: " + ", ".join(redlines) + "."
        )
    confirm_for = safety.get("require_owner_confirmation_for") or []
    if confirm_for:
        lines.append(
            "- These actions require the owner's explicit confirmation before you commit to them: "
            + ", ".join(confirm_for) + "."
        )
    return "\n".join(lines)


def _v2_phases_block(phases: dict | None) -> str:
    if not phases:
        return ""
    out = ["Conversation phases (use the speaker's current turn to decide tone/depth):"]
    for key in ("warmup", "discovery", "bonding"):
        p = phases.get(key)
        if p:
            out.append(f"- {key} (turns {p.get('turns', '?')}): {p.get('target', '')}")
    return "\n".join(out)


def _v2_boundaries_block(boundaries: dict | None) -> str:
    if not boundaries:
        return ""
    parts: list[str] = []
    avoid = boundaries.get("avoid_topics") or []
    if avoid:
        parts.append("Avoid these conversation topics: " + ", ".join(avoid) + ".")
    lang = boundaries.get("language")
    if lang:
        parts.append(f"Default language: {lang}.")
    formality = boundaries.get("formality")
    if formality:
        parts.append(f"Speak with a {formality} register.")
    if boundaries.get("nsfw") is False:
        parts.append("Keep all content SFW.")
    return " ".join(parts)


# Per-category nudge appended to the goal block. Keyed by Agent.goal_category;
# categories without an entry get the generic goal sentence only.
_GOAL_CATEGORY_NUDGES: dict[str, str] = {
    "dating": (
        "Gauge chemistry and shared values. Never reveal your owner's contact "
        "info in chat text — contact may only be shared through an approved tool."
    ),
    "recruiting": (
        "Assess whether the other person is a suitable candidate: skills, "
        "experience, and motivation relevant to the role."
    ),
    "job_seeking": (
        "Learn about the company, the role, and the working culture so your "
        "owner can judge whether to pursue an interview."
    ),
    "networking": "Look for professional common ground and mutually useful connections.",
    "mentorship": "Explore whether a mentoring relationship would benefit both sides.",
}


def _goal_block(speaker: Agent) -> str:
    """Render the owner's goal as the agent's top conversation priority.

    Returns "" when the agent has neither goal nor goal_category, so prompts
    for existing agents are byte-identical (same no-regression contract as the
    v2 blocks).
    """
    goal = getattr(speaker, "goal", None)
    category = getattr(speaker, "goal_category", None)
    if not goal and not category:
        return ""
    lines: list[str] = []
    if goal:
        lines.append(
            f"Your owner's goal for these conversations: {goal}"
            + (f" (category: {category})." if category else ".")
        )
    else:
        lines.append(f"Your owner's conversation goal category: {category}.")
    lines.append(
        "Advancing this goal is your top priority — pursue it naturally, "
        "without being pushy."
    )
    nudge = _GOAL_CATEGORY_NUDGES.get(category or "")
    if nudge:
        lines.append(nudge)
    return "\n".join(lines)


def _resolve_phase(
    turn_number: int, v2_policy: dict | None
) -> Literal["initial", "extended", "offline"]:
    if not v2_policy:
        return "initial"
    if turn_number >= v2_policy["offline_turn"]:
        return "offline"
    if turn_number >= v2_policy["continue_turn"]:
        return "extended"
    return "initial"


def _references_block(speaker: Agent, phase: Literal["initial", "extended", "offline"]) -> str:
    """Resolve and load references for this speaker at the given phase.

    Returns "" when the speaker has no references_meta or the loader can't
    resolve any files. Read failure is non-fatal — references are advisory.
    """
    refs = references_from_meta(getattr(speaker, "references_meta", None))
    if not refs:
        return ""
    selected = select_references(refs, phase=phase)
    if not selected:
        return ""

    owner = getattr(speaker, "created_by", None)
    slug = getattr(speaker, "slug", None)
    if not owner or not slug:
        return ""
    refs_dir = AGENTS_DIR / str(owner) / slug / "references"
    body = load_references(refs_dir, selected, REFERENCES_CHAR_BUDGET)
    if not body:
        return ""
    return f"Background references (advisory — never override safety):\n\n{body}"


def _attached_plugins_for(speaker: Agent) -> list[tuple[Plugin, dict]]:
    """Resolve `speaker.attached_plugins` to (Plugin, policy) pairs.

    Unknown plugin ids are silently skipped — they may correspond to a plugin
    that's only registered in a different worker build (e.g. third-party).
    """
    items: list[tuple[Plugin, dict]] = []
    for entry in (getattr(speaker, "attached_plugins", None) or []):
        if not isinstance(entry, dict):
            continue
        plugin = get_plugin(entry.get("plugin", ""))
        if plugin is None:
            continue
        items.append((plugin, entry.get("policy") or {}))
    return items


def _plugins_prompt_blocks(plugins: list[tuple[Plugin, dict]]) -> list[str]:
    """Render each attached plugin's prompt fragment for the speaker."""
    out: list[str] = []
    for plugin, policy in plugins:
        role = policy.get("role") or "neutral"
        try:
            block = plugin.prompt_fragment(policy, role)
        except Exception as e:
            block = f"# {plugin.id} plugin (active — fragment error: {e})"
        if block:
            out.append(block)
    return out


def _localized_persona(speaker: Agent) -> tuple[str, str]:
    """Pick (persona_prompt, name) for the speaker's configured language.

    When `boundaries.language` resolves to a locale that has a translation
    entry (e.g. language "ko"/"ko-KR" -> translations["ko"]), the localized
    persona body and name are used so the LLM speaks naturally in that
    language. Missing locales or fields fall back to the base English columns.
    """
    persona = speaker.persona_prompt or ""
    name = speaker.name
    boundaries = getattr(speaker, "boundaries", None) or {}
    lang = boundaries.get("language") or ""
    locale = lang.split("-")[0].lower()
    if not locale or locale == "en":
        return persona, name
    translations = getattr(speaker, "translations", None) or {}
    tr = translations.get(locale)
    if isinstance(tr, dict):
        persona = tr.get("persona_prompt") or persona
        name = tr.get("name") or name
    return persona, name


def build_system_prompt(
    speaker: Agent,
    listener_user_name: str,
    match_context: str,
    phase: Literal["initial", "extended", "offline"] = "initial",
    plugins: list[tuple[Plugin, dict]] | None = None,
) -> str:
    """Compose the worker system prompt.

    v2 fields (boundaries, conversation_phases, safety) are layered on top of
    the v1 persona_prompt. For v1 agents (no v2 fields populated yet) the
    output is identical to the previous behaviour — no regression.
    The persona body is placed BEFORE safety so that safety rules cannot be
    overridden by injected persona text. References (PR-5) are inserted as
    background context BEFORE safety as well.

    `plugins` is an optional list of (Plugin, policy) pairs attached to the
    speaker; each contributes a prompt_fragment block inserted after the match
    context. When None or empty, the prompt is identical to v1/v2 behaviour.
    """
    persona, speaker_name = _localized_persona(speaker)

    safety_block = _v2_safety_block(getattr(speaker, "safety", None))
    phases_block = _v2_phases_block(getattr(speaker, "conversation_phases", None))
    boundaries_block = _v2_boundaries_block(getattr(speaker, "boundaries", None))
    refs_block = _references_block(speaker, phase)
    goal_block = _goal_block(speaker)
    plugin_blocks = _plugins_prompt_blocks(plugins or [])

    sections: list[str] = [
        persona,
        f"You are {speaker_name}. Your tone is {speaker.tone}.",
        boundaries_block,
        phases_block,
        refs_block,
        f"You have just been matched with another person named {listener_user_name} on a virtual map.",
        f"The reason you were matched: {match_context}",
        goal_block,
        *plugin_blocks,
        "Have a natural, casual conversation. Keep your responses short — 2 to 4 sentences.",
        "Stay in character. Don't break the fourth wall or mention that you are an AI.",
        safety_block,
    ]
    return "\n\n".join(s for s in sections if s)


async def load_session_context(
    db: AsyncSession, session_id: UUID
) -> tuple[MatchSession, dict[UUID, Agent], dict[UUID, str], dict[UUID, str]]:
    """Returns (session, agents_by_id, agent_to_user_name, agent_to_model)."""
    session_obj = await db.get(MatchSession, session_id)
    if session_obj is None:
        raise ValueError(f"Session {session_id} not found")

    agents_stmt = select(Agent).where(
        Agent.id.in_([session_obj.agent_a_id, session_obj.agent_b_id])
    )
    agents_result = await db.execute(agents_stmt)
    agents = {a.id: a for a in agents_result.scalars()}

    users_stmt = select(User).where(
        User.id.in_([session_obj.user_a_id, session_obj.user_b_id])
    )
    users_result = await db.execute(users_stmt)
    users = {u.id: u for u in users_result.scalars()}

    user_agent_stmt = select(UserAgent).where(
        UserAgent.agent_id.in_(list(agents.keys())),
        UserAgent.is_active.is_(True),
    )
    ua_result = await db.execute(user_agent_stmt)
    agent_to_user_name: dict[UUID, str] = {}
    agent_to_model: dict[UUID, str] = {}
    for ua in ua_result.scalars():
        user = users[ua.user_id]
        agent_to_user_name[ua.agent_id] = user.display_name
        # Use user's preferred model, fall back to tier default
        agent_to_model[ua.agent_id] = (
            user.preferred_model or get_default_model()
        )
    return session_obj, agents, agent_to_user_name, agent_to_model


async def load_history(
    db: AsyncSession, session_id: UUID, speaker_agent_id: UUID
) -> list[dict]:
    stmt = (
        select(ConversationTurn)
        .where(ConversationTurn.session_id == session_id)
        .order_by(ConversationTurn.turn_number)
    )
    result = await db.execute(stmt)
    turns = list(result.scalars())
    messages = []
    for t in turns:
        role = "assistant" if t.agent_id == speaker_agent_id else "user"
        messages.append({"role": role, "content": t.content})
    return messages


def _resolve_v2_policy(speaker: Agent, listener: Agent) -> dict | None:
    """Resolve a shared escalation policy from both agents' v2 fields.

    Returns None when either agent lacks an escalation_policy (v1 fallback
    path). When both have one, take the more conservative thresholds (max)
    and the smaller turn budget (min) so neither agent feels pushed past
    their preference.
    """
    sp = getattr(speaker, "escalation_policy", None)
    lp = getattr(listener, "escalation_policy", None)
    if not sp or not lp:
        return None

    try:
        initial = min(int(sp.get("initial_turns", 30)), int(lp.get("initial_turns", 30)))
        extended = min(int(sp.get("extended_turns", 30)), int(lp.get("extended_turns", 30)))
        cont = max(float(sp.get("continue_threshold", 0.6)), float(lp.get("continue_threshold", 0.6)))
        offl = max(float(sp.get("offline_threshold", 0.8)), float(lp.get("offline_threshold", 0.8)))
    except (TypeError, ValueError):
        return None

    continue_turn = initial
    offline_turn = initial + extended
    return {
        "continue_turn": continue_turn,
        "offline_turn": offline_turn,
        "continue_threshold": cont,
        "offline_threshold": offl,
        "check_turns": {continue_turn, offline_turn},
    }


async def _analyze_affinity(
    db: AsyncSession, session_id: UUID, agents: dict[UUID, Agent]
) -> dict:
    """Use Haiku to analyze conversation affinity. Returns score, summary, recommendation."""
    stmt = (
        select(ConversationTurn)
        .where(ConversationTurn.session_id == session_id)
        .order_by(ConversationTurn.turn_number)
    )
    result = await db.execute(stmt)
    turns = list(result.scalars())

    # Build conversation summary for analysis
    lines = []
    for t in turns:
        agent = agents.get(t.agent_id)
        name = agent.name if agent else "Unknown"
        lines.append(f"{name}: {t.content}")
    conversation_text = "\n".join(lines[-20:])  # Last 20 turns max

    system = """You are analyzing a conversation between two people who were matched on a social platform.
Evaluate their compatibility and conversation quality.

Respond ONLY with a JSON object (no markdown, no extra text):
{"score": <0-100 integer>, "summary": "<1-2 sentence summary>", "recommendation": "<continue or end>"}

Score guide: 0-30 = poor match, 31-60 = okay, 61-80 = good, 81-100 = excellent."""

    messages = [{"role": "user", "content": f"Conversation:\n{conversation_text}"}]

    response = await generate(
        system=system,
        messages=messages,
        model=get_system_model(),
        max_tokens=200,
    )

    try:
        data = json_module.loads(response.text)
        return {
            "score": max(0, min(100, int(data.get("score", 50)))),
            "summary": str(data.get("summary", "Analysis unavailable")),
            "recommendation": "continue" if data.get("recommendation") != "end" else "end",
        }
    except (json_module.JSONDecodeError, ValueError):
        return {"score": 50, "summary": "Analysis unavailable", "recommendation": "continue"}


async def process_task(task: TurnTask) -> None:
    """Root trace for one conversation turn.

    Wraps `_run_turn` so the trace-level Langfuse attributes (session.id,
    trace.name, turn.number) are attached at the trace boundary. The
    speaker's user.id is filled in from inside once the session row is
    loaded.
    """
    tracer = get_tracer("islume.worker")
    with tracer.start_as_current_span("turn.process") as span:
        span.set_attribute("langfuse.observation.type", "trace")
        span.set_attribute("langfuse.session.id", str(task.session_id))
        span.set_attribute("langfuse.trace.name", f"turn-{task.turn_number}")
        span.set_attribute("turn.number", task.turn_number)
        span.set_attribute("turn.speaker_agent_id", str(task.speaker_agent_id))
        await _run_turn(task)


async def _run_turn(task: TurnTask) -> None:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        session_obj, agents, agent_to_user_name, agent_to_model = await load_session_context(
            db, task.session_id
        )
        if session_obj.status != "active":
            print(f"  [skip] session {task.session_id} status={session_obj.status}")
            return

        # Fill in speaker user.id now that we know which side of the session
        # the speaker is on. The root span is still active here.
        speaker_user_id = (
            session_obj.user_a_id
            if task.speaker_agent_id == session_obj.agent_a_id
            else session_obj.user_b_id
        )
        trace.get_current_span().set_attribute(
            "langfuse.user.id", str(speaker_user_id)
        )

        speaker = agents[task.speaker_agent_id]
        listener = agents[task.listener_agent_id]
        listener_name = agent_to_user_name[task.listener_agent_id]

        history = await load_history(db, task.session_id, task.speaker_agent_id)
        if task.is_opening:
            messages = [
                {"role": "user", "content": "(Start the conversation with a friendly opener.)"}
            ]
        else:
            messages = history

        # Resolve current escalation phase for references gating
        phase_policy = _resolve_v2_policy(speaker, listener)
        phase = _resolve_phase(task.turn_number, phase_policy)

        # Resolve intent plugins attached to the SPEAKER (listener's plugins
        # do not leak — each side sees only their own owner's tools).
        plugins_attached = _attached_plugins_for(speaker)
        tools_by_name: dict[str, tuple[ToolDef, Plugin, dict]] = {}
        for plugin, policy in plugins_attached:
            for tool in plugin.tools:
                tools_by_name[tool.name] = (tool, plugin, policy)
        tool_list = [triple[0] for triple in tools_by_name.values()]

        system = build_system_prompt(
            speaker,
            listener_name,
            session_obj.match_context,
            phase=phase,
            plugins=plugins_attached,
        )

        model = agent_to_model.get(speaker.id, "claude-haiku-4-5")

        start = time.monotonic()
        response: LLMResponse | GenerationResult = await generate(
            system=system,
            messages=messages,
            model=model,
            tools=tool_list if tool_list else None,
        )
        latency_ms = int((time.monotonic() - start) * 1000)

        tool_calls = getattr(response, "tool_calls", [])

        turn = ConversationTurn(
            session_id=task.session_id,
            agent_id=speaker.id,
            turn_number=task.turn_number,
            content=response.text or "",
            input_tokens=response.input_tokens,
            output_tokens=response.output_tokens,
            model_used=response.model,
            latency_ms=latency_ms,
        )
        db.add(turn)
        await db.flush()
        session_obj.turn_count = task.turn_number

        # ---- Process tool_calls ------------------------------------------------
        chat_events_to_publish: list[ChatEventSpec] = []
        pending_user_events: list[dict] = []
        end_session_now = False
        pending_paused = False
        turn_tool_calls_jsonb: list[dict] = []

        for tc in tool_calls:
            triple = tools_by_name.get(tc.name)
            if triple is None:
                # The model emitted a tool we don't expose for this speaker.
                # Treat as auto_rejected; do not invoke any handler.
                chat_events_to_publish.append(
                    ChatEventSpec(
                        event_type="tool_call",
                        payload={
                            "tool_call_id": tc.id,
                            "tool_name": tc.name,
                            "plugin": "unknown",
                            "status": "auto_rejected",
                            "arguments": tc.arguments,
                            "agent_id": str(speaker.id),
                            "reason": "unknown tool",
                        },
                    )
                )
                turn_tool_calls_jsonb.append(
                    {
                        "id": tc.id,
                        "name": tc.name,
                        "arguments": tc.arguments,
                        "plugin": "unknown",
                        "status": "auto_rejected",
                        "reason": "unknown tool",
                    }
                )
                continue

            tool, plugin, policy = triple
            ok, vreason = validate_arguments(tool, tc.arguments)
            if not ok:
                decision = PolicyDecision(status="auto_rejected", reason=vreason)
            else:
                try:
                    decision = tool.policy_check(tc.arguments, policy)
                except Exception as e:
                    decision = PolicyDecision(
                        status="auto_rejected", reason=f"policy_check error: {e}"
                    )

            audit = ToolCallEvent(
                session_id=session_obj.id,
                turn_number=task.turn_number,
                agent_id=speaker.id,
                user_id=speaker_user_id,
                plugin=plugin.id,
                tool_name=tc.name,
                arguments=tc.arguments,
                status="pending",  # corrected below
                policy_reason=decision.reason or None,
            )
            db.add(audit)
            await db.flush()

            entry_jsonb: dict = {
                "id": tc.id,
                "name": tc.name,
                "arguments": tc.arguments,
                "plugin": plugin.id,
                "tool_call_event_id": str(audit.id),
            }
            if decision.reason:
                entry_jsonb["policy_reason"] = decision.reason

            if decision.status == "auto_confirm":
                audit.status = "auto_confirmed"
                audit.resolved_at = datetime.utcnow()
                handler = plugin.handlers.get(tc.name)
                if handler is None:
                    audit.status = "auto_rejected"
                    audit.policy_reason = "no handler registered for tool"
                    entry_jsonb["status"] = "auto_rejected"
                    entry_jsonb["reason"] = "no handler"
                    chat_events_to_publish.append(
                        ChatEventSpec(
                            event_type="tool_call",
                            payload={
                                "tool_call_id": tc.id,
                                "plugin": plugin.id,
                                "tool_name": tc.name,
                                "status": "auto_rejected",
                                "arguments": tc.arguments,
                                "agent_id": str(speaker.id),
                                "reason": "no handler",
                            },
                        )
                    )
                else:
                    try:
                        handler_result = await handler(
                            db=db,
                            session=session_obj,
                            speaker=speaker,
                            listener=listener,
                            args=tc.arguments,
                            policy=policy,
                            turn_number=task.turn_number,
                            tool_call_id=tc.id,
                        )
                    except Exception as e:
                        import traceback

                        traceback.print_exc()
                        audit.status = "auto_rejected"
                        audit.policy_reason = f"handler error: {e}"
                        entry_jsonb["status"] = "auto_rejected"
                        entry_jsonb["reason"] = f"handler error: {e}"
                        chat_events_to_publish.append(
                            ChatEventSpec(
                                event_type="tool_call",
                                payload={
                                    "tool_call_id": tc.id,
                                    "plugin": plugin.id,
                                    "tool_name": tc.name,
                                    "status": "auto_rejected",
                                    "arguments": tc.arguments,
                                    "agent_id": str(speaker.id),
                                    "reason": f"handler error: {e}",
                                },
                            )
                        )
                    else:
                        chat_events_to_publish.extend(handler_result.chat_events)
                        if handler_result.end_session:
                            end_session_now = True
                        entry_jsonb["status"] = "auto_confirmed"

            elif decision.status == "pending":
                audit.status = "pending"
                pending_user_events.append(
                    {
                        "tool_call_id": str(audit.id),
                        "plugin": plugin.id,
                        "tool_name": tc.name,
                        "session_id": str(session_obj.id),
                        "summary": decision.reason
                        or f"{tc.name} requires your approval",
                    }
                )
                chat_events_to_publish.append(
                    ChatEventSpec(
                        event_type="tool_call",
                        payload={
                            "tool_call_id": str(audit.id),
                            "plugin": plugin.id,
                            "tool_name": tc.name,
                            "status": "pending",
                            "arguments": tc.arguments,
                            "agent_id": str(speaker.id),
                            "policy_reason": decision.reason,
                        },
                    )
                )
                pending_paused = True
                entry_jsonb["status"] = "pending"

            else:  # auto_rejected
                audit.status = "auto_rejected"
                audit.resolved_at = datetime.utcnow()
                chat_events_to_publish.append(
                    ChatEventSpec(
                        event_type="tool_call",
                        payload={
                            "tool_call_id": tc.id,
                            "plugin": plugin.id,
                            "tool_name": tc.name,
                            "status": "auto_rejected",
                            "arguments": tc.arguments,
                            "agent_id": str(speaker.id),
                            "reason": decision.reason,
                        },
                    )
                )
                entry_jsonb["status"] = "auto_rejected"
                entry_jsonb["reason"] = decision.reason

            turn_tool_calls_jsonb.append(entry_jsonb)

        if turn_tool_calls_jsonb:
            turn.tool_calls = turn_tool_calls_jsonb

        # Decide next action: continue, affinity check, final evaluation, or
        # complete. Plugin-driven outcomes take precedence over turn-count logic.
        next_task = None
        do_affinity_check = False
        final_eval_trigger: str | None = None
        v2_policy = _resolve_v2_policy(speaker, listener)

        if end_session_now:
            session_obj.status = "completed"
            final_eval_trigger = "session_end"
        elif pending_paused:
            session_obj.status = "awaiting_owner_confirmation"
            # next_task stays None — owner-confirm endpoint resumes the queue
        elif task.turn_number >= session_obj.max_turns:
            if task.turn_number >= MAX_TOTAL_TURNS:
                # Extension ceiling reached — record the evaluation but end.
                session_obj.status = "completed"
                final_eval_trigger = "session_end"
            else:
                # Pause for owner review; the evaluation drives the
                # continue(+extend)/end decision via affinity-response.
                final_eval_trigger = "max_turns"
        else:
            # Check if affinity analysis is due
            user_a = await db.get(User, session_obj.user_a_id)
            user_b = await db.get(User, session_obj.user_b_id)

            if v2_policy:
                is_check_turn = task.turn_number in v2_policy["check_turns"]
            else:
                check_interval = min(
                    user_a.affinity_check_turns if user_a else 20,
                    user_b.affinity_check_turns if user_b else 20,
                )
                is_check_turn = (
                    task.turn_number > 0 and task.turn_number % check_interval == 0
                )

            if is_check_turn:
                do_affinity_check = True
            else:
                next_task = TurnTask(
                    session_id=task.session_id,
                    turn_number=task.turn_number + 1,
                    speaker_agent_id=task.listener_agent_id,
                    listener_agent_id=task.speaker_agent_id,
                    is_opening=False,
                )

        if do_affinity_check:
            # Run affinity analysis with Haiku (cheap)
            affinity_result = await _analyze_affinity(db, task.session_id, agents)

            # v2: re-derive recommendation from score against policy thresholds
            if v2_policy:
                score_norm = affinity_result["score"] / 100.0
                if task.turn_number == v2_policy["offline_turn"]:
                    if score_norm >= v2_policy["offline_threshold"]:
                        affinity_result["recommendation"] = "offline_offer"
                    elif score_norm >= v2_policy["continue_threshold"]:
                        affinity_result["recommendation"] = "continue"
                    else:
                        affinity_result["recommendation"] = "end"
                else:  # continue check at v2_policy["continue_turn"]
                    if score_norm >= v2_policy["continue_threshold"]:
                        affinity_result["recommendation"] = "continue"
                    else:
                        affinity_result["recommendation"] = "end"

            session_obj.affinity_score = affinity_result["score"]
            session_obj.affinity_summary = affinity_result["summary"]
            session_obj.affinity_recommendation = affinity_result["recommendation"]
            session_obj.affinity_checked_at = datetime.utcnow()
            session_obj.user_a_affinity_response = None
            session_obj.user_b_affinity_response = None

            # Check auto-approve
            both_auto = (
                (user_a and user_a.auto_approve_affinity)
                and (user_b and user_b.auto_approve_affinity)
                and affinity_result["recommendation"] == "continue"
            )
            if both_auto:
                # Both auto-approve and LLM says continue — skip review
                session_obj.user_a_affinity_response = "continue"
                session_obj.user_b_affinity_response = "continue"
                next_task = TurnTask(
                    session_id=task.session_id,
                    turn_number=task.turn_number + 1,
                    speaker_agent_id=task.listener_agent_id,
                    listener_agent_id=task.speaker_agent_id,
                    is_opening=False,
                )
                print(f"  [affinity] auto-approved: score={affinity_result['score']:.0f}")
            else:
                # Need user review — pause the session
                session_obj.status = "awaiting_review"
                # Pre-fill auto-approve users
                if user_a and user_a.auto_approve_affinity and affinity_result["recommendation"] == "continue":
                    session_obj.user_a_affinity_response = "continue"
                if user_b and user_b.auto_approve_affinity and affinity_result["recommendation"] == "continue":
                    session_obj.user_b_affinity_response = "continue"
                print(f"  [affinity] awaiting review: score={affinity_result['score']:.0f}, rec={affinity_result['recommendation']}")

        # Final (or end-of-session) partner evaluation: one system-model call
        # produces both sides' category-specific verdicts. Rows + inbox
        # notifications land in the SAME transaction as the status change.
        # Evaluations are owner-private — only the content-free marker rides
        # the shared session stream; owners fetch their own row via REST.
        eval_owner_by_agent: dict[UUID, UUID] = {}
        eval_results: dict[UUID, dict] | None = None
        if final_eval_trigger is not None:
            eval_results = await analyze_partner_evaluations(db, session_obj, agents)
            eval_owner_by_agent = {
                session_obj.agent_a_id: session_obj.user_a_id,
                session_obj.agent_b_id: session_obj.user_b_id,
            }
            for aid, res in eval_results.items():
                partner_aid = (
                    session_obj.agent_b_id
                    if aid == session_obj.agent_a_id
                    else session_obj.agent_a_id
                )
                db.add(
                    PartnerEvaluation(
                        session_id=session_obj.id,
                        agent_id=aid,
                        user_id=eval_owner_by_agent[aid],
                        evaluated_agent_id=partner_aid,
                        goal_category=res["goal_category"],
                        template=res["template"],
                        verdicts=res["verdicts"],
                        score=res["score"],
                        summary=res["summary"],
                        turn_number=task.turn_number,
                        trigger=final_eval_trigger,
                    )
                )
                add_notification(
                    db,
                    user_id=eval_owner_by_agent[aid],
                    type="evaluation:ready",
                    session_id=session_obj.id,
                    payload={
                        "session_id": str(session_obj.id),
                        "trigger": final_eval_trigger,
                        "turn_number": task.turn_number,
                        "score": res["score"],
                        "summary": res["summary"],
                    },
                )
            # Mirror the owner-agnostic score into the shared affinity fields so
            # existing tooling keeps working; private summaries stay out.
            scores = [r["score"] for r in eval_results.values()]
            recs = [r["recommendation"] for r in eval_results.values()]
            session_obj.affinity_score = sum(scores) / len(scores)
            session_obj.affinity_recommendation = (
                "end" if "end" in recs else "continue"
            )
            session_obj.affinity_checked_at = datetime.utcnow()
            if final_eval_trigger == "max_turns":
                session_obj.user_a_affinity_response = None
                session_obj.user_b_affinity_response = None
                session_obj.status = "awaiting_review"
            print(
                f"  [evaluation] trigger={final_eval_trigger} "
                f"scores={[r['score'] for r in eval_results.values()]} "
                f"status={session_obj.status}"
            )

        # Durable inbox rows for pending confirmations — same transaction as
        # the status change, so the toast never references a missing row.
        for pending in pending_user_events:
            add_notification(
                db,
                user_id=speaker_user_id,
                type="deal:pending_confirmation",
                session_id=session_obj.id,
                payload=pending,
            )

        await db.commit()

        speaker_name = agent_to_user_name[speaker.id]
        print(f"\n  [{speaker_name} ({speaker.name})] turn {task.turn_number}: {response.text}")
        print(
            f"    in={response.input_tokens} out={response.output_tokens} "
            f"latency={latency_ms}ms cost=${response.cost_usd:.5f}"
        )

        # Publish turn event to session stream (durable, replayable)
        r = get_redis()
        turn_event = ChatEvent(
            event_type="turn",
            session_id=task.session_id,
            turn_number=task.turn_number,
            speaker_agent_id=speaker.id,
            speaker_name=f"{speaker_name} ({speaker.name})",
            content=response.text or "",
            model_used=response.model,
        )
        await r.xadd(session_stream(task.session_id), turn_event.to_redis())

        # Publish each plugin-emitted ChatEvent (tool_call, deal_finalized, ...).
        for spec in chat_events_to_publish:
            ev = ChatEvent(
                event_type=spec.event_type,
                session_id=task.session_id,
                turn_number=task.turn_number,
                content=json_module.dumps(spec.payload),
            )
            await r.xadd(session_stream(task.session_id), ev.to_redis())

        # Publish follow-up events. The final_evaluation marker is content-free
        # on purpose: the session stream is shared by both participants, and
        # evaluations are owner-private (fetched per-owner via REST).
        if eval_results is not None:
            marker = ChatEvent(
                event_type="final_evaluation",
                session_id=task.session_id,
                turn_number=task.turn_number,
                content=json_module.dumps({
                    "reason": final_eval_trigger,
                    "turn_number": task.turn_number,
                }),
            )
            await r.xadd(session_stream(task.session_id), marker.to_redis())

        if session_obj.status == "completed":
            end_event = ChatEvent(
                event_type="session_ended",
                session_id=task.session_id,
            )
            await r.xadd(session_stream(task.session_id), end_event.to_redis())
        elif session_obj.status == "awaiting_review" and eval_results is None:
            affinity_event = ChatEvent(
                event_type="affinity_check",
                session_id=task.session_id,
                content=json_module.dumps({
                    "score": session_obj.affinity_score,
                    "summary": session_obj.affinity_summary,
                    "recommendation": session_obj.affinity_recommendation,
                }),
            )
            await r.xadd(session_stream(task.session_id), affinity_event.to_redis())

        if next_task is not None:
            await r.xadd(STREAM_LLM_TASKS, next_task.to_redis())

        # Notify the speaker's owner about any pending tool_call confirmations.
        # Done after stream publishes so the owner toast lands AFTER the chat UI
        # has rendered the in-line "pending" tool_call card.
        for pending in pending_user_events:
            await publish_user_event(
                speaker_user_id,
                "deal:pending_confirmation",
                pending,
            )

        # Tell each owner their private evaluation is ready (live toast; the
        # durable inbox row was committed above for offline users).
        if eval_results is not None:
            for aid, res in eval_results.items():
                await publish_user_event(
                    eval_owner_by_agent[aid],
                    "evaluation:ready",
                    {
                        "session_id": str(session_obj.id),
                        "trigger": final_eval_trigger or "",
                        "turn_number": str(task.turn_number),
                        "score": str(res["score"]),
                        "summary": res["summary"],
                    },
                )


async def run_worker():
    r = get_redis()
    try:
        await r.xgroup_create(
            STREAM_LLM_TASKS, CONSUMER_GROUP, id="0", mkstream=True
        )
    except Exception as e:
        if "BUSYGROUP" not in str(e):
            raise
    print(f"Worker {WORKER_NAME} started, listening on {STREAM_LLM_TASKS}")

    while True:
        try:
            response = await r.xreadgroup(
                groupname=CONSUMER_GROUP,
                consumername=WORKER_NAME,
                streams={STREAM_LLM_TASKS: ">"},
                count=1,
                block=BLOCK_MS,
            )
        except Exception as e:
            print(f"Error reading from stream: {e}")
            await asyncio.sleep(1)
            continue

        if not response:
            continue

        for _stream_name, entries in response:
            for entry_id, data in entries:
                try:
                    task = TurnTask.from_redis(data)
                    await process_task(task)
                    await r.xack(STREAM_LLM_TASKS, CONSUMER_GROUP, entry_id)
                except Exception as e:
                    print(f"Error processing task {entry_id}: {e}")
                    import traceback
                    traceback.print_exc()


async def main():
    init_telemetry("islume-worker")
    try:
        await run_worker()
    finally:
        await close_redis()


if __name__ == "__main__":
    asyncio.run(main())
