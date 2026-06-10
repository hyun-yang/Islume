"""Base types for intent plugins.

An intent plugin packages five surfaces:
  - id                      stable string persisted in agents.attached_plugins[].plugin
  - tools                   list[ToolDef] — JSON-Schema tool definitions fed to LLM + policy gate
  - policy_schema           JSON-Schema for the per-attachment owner policy form
  - prompt_fragment         (policy, role) -> str — text block appended to system prompt
  - handlers                dict[tool_name, ToolHandler] — DB-mutating side effects
  - card_kind               stable key the frontend uses to pick a renderer

The worker calls a tool's policy_check(args, policy) → PolicyDecision before invoking
the handler. Handlers return HandlerResult (side effects + ChatEvents) — they MUST
NOT enqueue next turns or interact with Redis streams directly. The worker owns the
self-perpetuating queue.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Literal

PolicyStatus = Literal["auto_confirm", "pending", "auto_rejected"]


@dataclass(frozen=True)
class PolicyDecision:
    status: PolicyStatus
    reason: str = ""


PolicyCheck = Callable[[dict, dict], PolicyDecision]
"""Signature: (tool_args, owner_policy) -> PolicyDecision."""


@dataclass(frozen=True)
class ToolDef:
    name: str
    description: str
    parameters: dict
    policy_check: PolicyCheck
    # When True, the worker substitutes {"redacted": true} for this tool's
    # arguments in everything BOTH participants can see pre-approval (the
    # shared session stream and turn.tool_calls). The raw args stay in the
    # ToolCallEvent audit row and the owner-only user event; the handler's
    # own post-approval events deliver the real payload. Use for arguments
    # that must not leak before the owner confirms (e.g. contact info).
    redact_args: bool = False


@dataclass(frozen=True)
class ToolCall:
    """Normalized tool call from any provider (Anthropic/OpenAI/Gemini/Ollama)."""

    id: str
    name: str
    arguments: dict


@dataclass
class ChatEventSpec:
    """A ChatEvent the handler wants the worker to publish on the session stream."""

    event_type: str
    payload: dict


@dataclass
class HandlerResult:
    """What a handler returns to the worker.

    side_effects:  human-readable list of what changed (audit/log only)
    chat_events:   events to publish on stream:session:{id}
    end_session:   if True, worker sets session.status="completed" and skips next-turn enqueue
    """

    side_effects: list[str] = field(default_factory=list)
    chat_events: list[ChatEventSpec] = field(default_factory=list)
    end_session: bool = False


# DB session + match session model are passed in opaquely so this module
# doesn't depend on shared.models (would cause circular import).
ToolHandler = Callable[..., Awaitable[HandlerResult]]
"""Signature (kwargs):
  db:        AsyncSession
  session:   MatchSession (already loaded)
  speaker:   Agent (the one calling the tool)
  listener:  Agent
  args:      dict (validated tool arguments)
  policy:    dict (the speaker-side plugin policy)
  turn_number: int
  tool_call_id: str
"""


PromptFragment = Callable[[dict, str], str]
"""Signature: (owner_policy, role) -> str."""


@dataclass(frozen=True)
class Plugin:
    id: str
    tools: list[ToolDef]
    policy_schema: dict
    prompt_fragment: PromptFragment
    handlers: dict[str, ToolHandler]
    card_kind: str
    description: str = ""

    def tool_by_name(self, name: str) -> ToolDef | None:
        for t in self.tools:
            if t.name == name:
                return t
        return None

    def tool_names(self) -> list[str]:
        return [t.name for t in self.tools]


def validate_arguments(tool: ToolDef, args: dict) -> tuple[bool, str]:
    """Lightweight JSON Schema check — required keys + basic type/range.

    Not a full Draft-07 validator. The LLM produces well-formed JSON most of the time;
    this catches obvious omissions before policy_check.
    """
    params = tool.parameters
    if params.get("type") != "object":
        return True, ""
    required: list[str] = params.get("required", [])
    for key in required:
        if key not in args:
            return False, f"missing required field: {key}"
    props: dict[str, dict] = params.get("properties", {})
    if params.get("additionalProperties") is False:
        for key in args:
            if key not in props:
                return False, f"unknown field: {key}"
    for key, value in args.items():
        spec = props.get(key)
        if not spec:
            continue
        expected = spec.get("type")
        if expected == "integer" and not isinstance(value, int):
            return False, f"{key} must be integer"
        if expected == "string" and not isinstance(value, str):
            return False, f"{key} must be string"
        if expected == "number" and not isinstance(value, (int, float)):
            return False, f"{key} must be number"
        if expected == "boolean" and not isinstance(value, bool):
            return False, f"{key} must be boolean"
        if expected == "integer" and isinstance(value, int):
            lo, hi = spec.get("minimum"), spec.get("maximum")
            if lo is not None and value < lo:
                return False, f"{key} below minimum {lo}"
            if hi is not None and value > hi:
                return False, f"{key} above maximum {hi}"
        if expected == "string" and isinstance(value, str):
            enum = spec.get("enum")
            if enum is not None and value not in enum:
                return False, f"{key} not in {enum}"
    return True, ""
