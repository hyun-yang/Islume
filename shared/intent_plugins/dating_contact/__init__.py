"""Dating intent plugin — offline meeting + contact sharing between agents."""

from __future__ import annotations

from shared.intent_plugins.base import Plugin
from shared.intent_plugins.dating_contact.handlers import HANDLERS
from shared.intent_plugins.dating_contact.policy import POLICY_SCHEMA
from shared.intent_plugins.dating_contact.prompt import prompt_fragment
from shared.intent_plugins.dating_contact.tools import TOOLS

plugin = Plugin(
    id="dating_contact",
    tools=TOOLS,
    policy_schema=POLICY_SCHEMA,
    prompt_fragment=prompt_fragment,
    handlers=HANDLERS,
    card_kind="dating_contact",
    description=(
        "Dating intent: clearly propose/accept/decline offline meetings and "
        "share contact info. Tools: propose_offline_meeting, "
        "accept_offline_meeting, decline_offline_meeting, share_contact. "
        "Meetings and contact sharing always require owner approval; contact "
        "args are redacted on the shared stream until approved."
    ),
)

__all__ = ["plugin"]
