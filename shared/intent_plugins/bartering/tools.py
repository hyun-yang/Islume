"""Bartering tools — six ToolDef instances exported as TOOLS list.

Args reference the *currently open* proposal in the session (invariant: max 1).
The LLM does not pass proposal_id; handlers resolve "the open proposal" at call time.
"""

from __future__ import annotations

from shared.intent_plugins.bartering import policy as bp
from shared.intent_plugins.base import ToolDef

_propose_price_params: dict = {
    "type": "object",
    "required": ["amount", "currency", "item_name"],
    "properties": {
        "amount": {"type": "integer", "minimum": 1, "maximum": 1_000_000},
        "currency": {"type": "string", "enum": ["ISL", "USD"]},
        "item_name": {"type": "string", "minLength": 2, "maxLength": 80},
        "terms": {"type": "string", "maxLength": 300},
    },
    "additionalProperties": False,
}

_counter_offer_params: dict = {
    "type": "object",
    "required": ["amount"],
    "properties": {
        "amount": {"type": "integer", "minimum": 1, "maximum": 1_000_000},
        "terms": {"type": "string", "maxLength": 300},
    },
    "additionalProperties": False,
}

_accept_offer_params: dict = {
    "type": "object",
    "required": ["amount"],
    "properties": {
        "amount": {"type": "integer", "minimum": 1, "maximum": 1_000_000},
    },
    "additionalProperties": False,
}

_reject_offer_params: dict = {
    "type": "object",
    "required": [],
    "properties": {
        "reason": {"type": "string", "maxLength": 300},
    },
    "additionalProperties": False,
}

_share_reference_params: dict = {
    "type": "object",
    "required": ["kind", "url"],
    "properties": {
        "kind": {"type": "string", "enum": ["photo", "link", "doc"]},
        "url": {"type": "string", "maxLength": 500},
        "label": {"type": "string", "maxLength": 80},
    },
    "additionalProperties": False,
}

_withdraw_params: dict = {
    "type": "object",
    "required": [],
    "properties": {
        "reason": {"type": "string", "maxLength": 300},
    },
    "additionalProperties": False,
}


TOOLS: list[ToolDef] = [
    ToolDef(
        name="propose_price",
        description=(
            "Make an initial price offer for the item. Use when no open proposal exists, "
            "or to replace your previous proposal with a different amount."
        ),
        parameters=_propose_price_params,
        policy_check=bp.check_propose_price,
    ),
    ToolDef(
        name="counter_offer",
        description=(
            "Counter the currently open proposal with a different amount. "
            "Use only when the other party has an open proposal you want to renegotiate."
        ),
        parameters=_counter_offer_params,
        policy_check=bp.check_counter_offer,
    ),
    ToolDef(
        name="accept_offer",
        description=(
            "Accept the currently open proposal. `amount` must equal the open proposal's amount; "
            "the handler will verify and reject mismatches."
        ),
        parameters=_accept_offer_params,
        policy_check=bp.check_accept_offer,
    ),
    ToolDef(
        name="reject_offer",
        description="Reject the currently open proposal. Conversation continues — you may propose a new amount next turn.",
        parameters=_reject_offer_params,
        policy_check=bp.check_reject_offer,
    ),
    ToolDef(
        name="share_reference",
        description="Share a URL (photo, link, doc) to give the other party context — e.g. product photo, listing URL.",
        parameters=_share_reference_params,
        policy_check=bp.check_share_reference,
    ),
    ToolDef(
        name="withdraw",
        description="Withdraw from the deal. All open proposals are closed; chat continues.",
        parameters=_withdraw_params,
        policy_check=bp.check_withdraw,
    ),
]
