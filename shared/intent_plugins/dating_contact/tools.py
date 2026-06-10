"""Dating tools — four ToolDef instances exported as TOOLS list.

share_contact carries the owner's real handle, so it is marked
redact_args=True: pre-approval, both participants only ever see
{"redacted": true} on the shared session stream. The real handle is
delivered exclusively by the handler AFTER the owner approves.
"""

from __future__ import annotations

from shared.intent_plugins.base import ToolDef
from shared.intent_plugins.dating_contact import policy as dp

_propose_offline_meeting_params: dict = {
    "type": "object",
    "required": [],
    "properties": {
        "place_hint": {"type": "string", "maxLength": 120},
        "time_hint": {"type": "string", "maxLength": 120},
        "message": {"type": "string", "maxLength": 300},
    },
    "additionalProperties": False,
}

_accept_offline_meeting_params: dict = {
    "type": "object",
    "required": [],
    "properties": {
        "message": {"type": "string", "maxLength": 300},
    },
    "additionalProperties": False,
}

_decline_offline_meeting_params: dict = {
    "type": "object",
    "required": [],
    "properties": {
        "reason": {"type": "string", "maxLength": 300},
    },
    "additionalProperties": False,
}

_share_contact_params: dict = {
    "type": "object",
    "required": ["channel", "handle"],
    "properties": {
        "channel": {
            "type": "string",
            "enum": ["phone", "email", "instagram", "kakao", "line", "discord", "other"],
        },
        "handle": {"type": "string", "minLength": 2, "maxLength": 120},
        "message": {"type": "string", "maxLength": 300},
    },
    "additionalProperties": False,
}


TOOLS: list[ToolDef] = [
    ToolDef(
        name="propose_offline_meeting",
        description=(
            "Clearly propose meeting the other person offline. Use when the "
            "chemistry is genuinely good. Requires your owner's approval before "
            "it is delivered."
        ),
        parameters=_propose_offline_meeting_params,
        policy_check=dp.check_propose_offline_meeting,
    ),
    ToolDef(
        name="accept_offline_meeting",
        description=(
            "Accept the currently open offline-meeting proposal. Requires your "
            "owner's approval before it takes effect."
        ),
        parameters=_accept_offline_meeting_params,
        policy_check=dp.check_accept_offline_meeting,
    ),
    ToolDef(
        name="decline_offline_meeting",
        description=(
            "Clearly but kindly decline the open offline-meeting proposal. "
            "Conversation continues."
        ),
        parameters=_decline_offline_meeting_params,
        policy_check=dp.check_decline_offline_meeting,
    ),
    ToolDef(
        name="share_contact",
        description=(
            "Share your owner's contact handle with the other party. NEVER write "
            "contact info in chat text — this tool is the only allowed channel, "
            "and it always requires your owner's approval."
        ),
        parameters=_share_contact_params,
        policy_check=dp.check_share_contact,
        redact_args=True,
    ),
]
