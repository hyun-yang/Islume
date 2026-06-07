"""Bartering intent plugin — item/price negotiation between agents."""

from __future__ import annotations

from shared.intent_plugins.bartering.handlers import HANDLERS
from shared.intent_plugins.bartering.policy import POLICY_SCHEMA
from shared.intent_plugins.bartering.prompt import prompt_fragment
from shared.intent_plugins.bartering.tools import TOOLS
from shared.intent_plugins.base import Plugin

plugin = Plugin(
    id="bartering",
    tools=TOOLS,
    policy_schema=POLICY_SCHEMA,
    prompt_fragment=prompt_fragment,
    handlers=HANDLERS,
    card_kind="bartering",
    description="Price negotiation for selling/buying an item. Tools: propose_price, counter_offer, accept_offer, reject_offer, share_reference, withdraw.",
)


__all__ = ["plugin"]
