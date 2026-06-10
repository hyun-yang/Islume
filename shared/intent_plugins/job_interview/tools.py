"""Job interview tools — three ToolDef instances exported as TOOLS list.

Like bartering, args reference the *currently open* interview request in the
session (invariant: max 1). The LLM never passes proposal ids.
"""

from __future__ import annotations

from shared.intent_plugins.base import ToolDef
from shared.intent_plugins.job_interview import policy as jp

_request_interview_params: dict = {
    "type": "object",
    "required": [],
    "properties": {
        "message": {"type": "string", "maxLength": 300},
        "position": {"type": "string", "maxLength": 120},
    },
    "additionalProperties": False,
}

_accept_interview_params: dict = {
    "type": "object",
    "required": [],
    "properties": {
        "message": {"type": "string", "maxLength": 300},
    },
    "additionalProperties": False,
}

_decline_interview_params: dict = {
    "type": "object",
    "required": [],
    "properties": {
        "reason": {"type": "string", "maxLength": 300},
    },
    "additionalProperties": False,
}


TOOLS: list[ToolDef] = [
    ToolDef(
        name="request_interview",
        description=(
            "Formally request a job interview with the other party. Use once the "
            "conversation shows a real fit. Requires your owner's approval before "
            "it is delivered."
        ),
        parameters=_request_interview_params,
        policy_check=jp.check_request_interview,
    ),
    ToolDef(
        name="accept_interview",
        description=(
            "Accept the currently open interview request from the other party. "
            "Requires your owner's approval before it takes effect."
        ),
        parameters=_accept_interview_params,
        policy_check=jp.check_accept_interview,
    ),
    ToolDef(
        name="decline_interview",
        description=(
            "Politely decline the currently open interview request. "
            "Conversation continues."
        ),
        parameters=_decline_interview_params,
        policy_check=jp.check_decline_interview,
    ),
]
