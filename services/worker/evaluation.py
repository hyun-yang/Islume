"""Category-specific partner evaluation.

Templates are data: each goal_category maps to a template whose boolean/enum
verdict fields the system model fills in. One LLM call evaluates BOTH sides
of the conversation (asymmetric templates included), keeping checkpoint cost
at a single Haiku call. Parse failure degrades to neutral verdicts with
recommendation="continue" — callers must still pause the session; a failed
evaluation must never silently complete a conversation.
"""

import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.llm import generate, get_system_model
from shared.models import Agent, ConversationTurn, MatchSession

# How many recent turns the evaluator sees (same window as affinity analysis).
EVAL_TURN_WINDOW = 20

# goal_category → template key. Unknown/empty categories fall back to hobby.
CATEGORY_TO_TEMPLATE: dict[str, str] = {
    "dating": "dating",
    "recruiting": "recruiting",
    "job_seeking": "job_seeking",
    "networking": "professional",
    "mentorship": "professional",
    "casual_chat": "hobby",
    "companionship": "hobby",
    "collaboration": "hobby",
}
DEFAULT_TEMPLATE = "hobby"

# Each template: verdict field name → (prompt description, neutral fallback).
TEMPLATE_FIELDS: dict[str, dict[str, tuple[str, object]]] = {
    "hobby": {
        "meet_again": ("true if this agent would want to talk with the partner again", False),
        "offline_meeting": ("true if an offline meetup seems worthwhile", False),
    },
    "recruiting": {
        "candidate_suitable": ("true if the partner looks like a suitable candidate", False),
        "request_interview": ("true if an interview should be requested", False),
    },
    "job_seeking": {
        "company_impression": ('"good" or "bad" — impression of the partner\'s company/role', "good"),
        "want_interview": ("true if this agent's owner should pursue an interview", False),
    },
    "dating": {
        "offline_meeting": ("true if an offline date seems like a good idea", False),
        "share_contact": ("true if sharing contact info with the partner is warranted", False),
    },
    "professional": {
        "continue_relationship": ("true if the professional relationship is worth continuing", False),
        "offline_meeting": ("true if meeting offline would be valuable", False),
    },
}


def template_for(agent: Agent) -> str:
    category = getattr(agent, "goal_category", None) or ""
    return CATEGORY_TO_TEMPLATE.get(category, DEFAULT_TEMPLATE)


def _neutral_result(agent: Agent) -> dict:
    tmpl = template_for(agent)
    return {
        "template": tmpl,
        "goal_category": getattr(agent, "goal_category", None),
        "verdicts": {k: fallback for k, (_, fallback) in TEMPLATE_FIELDS[tmpl].items()},
        "score": 50,
        "summary": "Analysis unavailable",
        "recommendation": "continue",
    }


def _side_spec(label: str, agent: Agent) -> str:
    tmpl = template_for(agent)
    fields = ",\n".join(
        f'    "{name}": <{desc}>' for name, (desc, _) in TEMPLATE_FIELDS[tmpl].items()
    )
    goal = getattr(agent, "goal", None) or "(not specified)"
    return (
        f'"{label}" — evaluation BY {agent.name} of its partner.\n'
        f"{agent.name}'s owner goal: {goal} (category: "
        f"{getattr(agent, 'goal_category', None) or 'none'}, template: {tmpl}).\n"
        f'"{label}" must be an object:\n'
        "{\n"
        f"{fields},\n"
        '    "score": <0-100 integer, how well the partner fits this goal>,\n'
        '    "summary": "<1-2 sentence private summary for the owner>",\n'
        '    "recommendation": "<continue or end>"\n'
        "}"
    )


def _parse_side(raw: object, agent: Agent) -> dict:
    """Validate one side's verdict object, coercing to the template's fields."""
    neutral = _neutral_result(agent)
    if not isinstance(raw, dict):
        return neutral
    tmpl = neutral["template"]
    verdicts: dict = {}
    for name, (_, fallback) in TEMPLATE_FIELDS[tmpl].items():
        value = raw.get(name, fallback)
        if isinstance(fallback, bool):
            verdicts[name] = value is True or value == "true"
        else:  # enum-style string field
            verdicts[name] = value if isinstance(value, str) else fallback
    try:
        score = max(0, min(100, int(raw.get("score", 50))))
    except (TypeError, ValueError):
        score = 50
    return {
        "template": tmpl,
        "goal_category": neutral["goal_category"],
        "verdicts": verdicts,
        "score": score,
        "summary": str(raw.get("summary", "Analysis unavailable")),
        "recommendation": "continue" if raw.get("recommendation") != "end" else "end",
    }


async def analyze_partner_evaluations(
    db: AsyncSession,
    session_obj: MatchSession,
    agents: dict[UUID, Agent],
) -> dict[UUID, dict]:
    """Evaluate both sides of a conversation in ONE system-model call.

    Returns {agent_id: {template, goal_category, verdicts, score, summary,
    recommendation}} for agent_a and agent_b. Never raises on LLM/parse
    failure — degrades to neutral results so the checkpoint pause still
    happens.
    """
    agent_a = agents[session_obj.agent_a_id]
    agent_b = agents[session_obj.agent_b_id]

    stmt = (
        select(ConversationTurn)
        .where(ConversationTurn.session_id == session_obj.id)
        .order_by(ConversationTurn.turn_number)
    )
    turns = list((await db.execute(stmt)).scalars())
    lines = []
    for t in turns:
        agent = agents.get(t.agent_id)
        lines.append(f"{agent.name if agent else 'Unknown'}: {t.content}")
    conversation_text = "\n".join(lines[-EVAL_TURN_WINDOW:])

    system = (
        "You are evaluating a conversation between two agents on a social "
        "platform. Produce a PRIVATE evaluation for each side's owner — each "
        "side judges its PARTNER against its own goal.\n\n"
        "Respond ONLY with a JSON object (no markdown, no extra text):\n"
        '{"side_a": {...}, "side_b": {...}}\n\n'
        + _side_spec("side_a", agent_a)
        + "\n\n"
        + _side_spec("side_b", agent_b)
        + "\n\nScore guide: 0-30 = poor fit, 31-60 = okay, 61-80 = good, 81-100 = excellent."
    )
    messages = [{"role": "user", "content": f"Conversation:\n{conversation_text}"}]

    try:
        response = await generate(
            system=system,
            messages=messages,
            model=get_system_model(),
            max_tokens=500,
        )
        data = json.loads(response.text)
    except Exception as e:
        print(f"  [evaluation] analysis failed, using neutral fallback: {e}")
        data = {}

    return {
        agent_a.id: _parse_side(data.get("side_a"), agent_a),
        agent_b.id: _parse_side(data.get("side_b"), agent_b),
    }
