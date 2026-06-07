"""Bartering plugin — owner policy schema + per-tool policy checks.

Invariant: at most one OPEN proposal exists per session. New proposals supersede
the previous open one; counter_offer/accept_offer/reject_offer all act on it.
This removes the need for proposal_id tracking by the LLM.
"""

from __future__ import annotations

from shared.intent_plugins.base import PolicyDecision
from shared.intent_plugins.policy import host_allowed, in_range

POLICY_SCHEMA: dict = {
    "type": "object",
    "required": ["role", "item_name", "currency", "price_range"],
    "properties": {
        "role": {"type": "string", "enum": ["seller", "buyer"]},
        "item_name": {"type": "string", "minLength": 2, "maxLength": 80},
        "currency": {"type": "string", "enum": ["ISL", "USD"]},
        "price_range": {
            "type": "object",
            "required": ["min", "max"],
            "properties": {
                "min": {"type": "integer", "minimum": 0, "maximum": 1_000_000},
                "max": {"type": "integer", "minimum": 0, "maximum": 1_000_000},
            },
        },
        "auto_accept_at_or_above": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1_000_000,
        },
        "auto_reject_below": {"type": "integer", "minimum": 0, "maximum": 1_000_000},
        "max_rounds": {"type": "integer", "minimum": 1, "maximum": 50},
        "photo_url": {"type": "string"},
        "allowed_reference_hosts": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
    "additionalProperties": False,
}


def _price_range(policy: dict) -> tuple[int | None, int | None]:
    pr = policy.get("price_range") or {}
    return pr.get("min"), pr.get("max")


def check_propose_price(args: dict, policy: dict) -> PolicyDecision:
    amount = args.get("amount")
    if not isinstance(amount, int):
        return PolicyDecision(status="auto_rejected", reason="amount must be integer")
    lo, hi = _price_range(policy)
    reject_below = policy.get("auto_reject_below")
    if reject_below is not None and amount < reject_below:
        return PolicyDecision(
            status="auto_rejected",
            reason=f"amount {amount} below auto_reject_below {reject_below}",
        )
    if not in_range(amount, lo, hi):
        return PolicyDecision(
            status="pending",
            reason=f"amount {amount} outside price_range [{lo},{hi}]",
        )
    return PolicyDecision(status="auto_confirm")


# counter_offer enforces the same bounds as propose_price.
check_counter_offer = check_propose_price


def check_accept_offer(args: dict, policy: dict) -> PolicyDecision:
    amount = args.get("amount")
    if not isinstance(amount, int):
        return PolicyDecision(status="auto_rejected", reason="amount must be integer")
    floor = policy.get("auto_accept_at_or_above")
    lo, hi = _price_range(policy)
    if not in_range(amount, lo, hi):
        return PolicyDecision(
            status="pending",
            reason=f"amount {amount} outside price_range [{lo},{hi}]",
        )
    if floor is not None and amount >= floor:
        return PolicyDecision(status="auto_confirm")
    return PolicyDecision(
        status="pending",
        reason=f"amount {amount} below auto_accept_at_or_above {floor}",
    )


def check_reject_offer(_args: dict, _policy: dict) -> PolicyDecision:
    return PolicyDecision(status="auto_confirm")


def check_withdraw(_args: dict, _policy: dict) -> PolicyDecision:
    return PolicyDecision(status="auto_confirm")


def check_share_reference(args: dict, policy: dict) -> PolicyDecision:
    url = args.get("url", "")
    allowed = policy.get("allowed_reference_hosts")
    if host_allowed(url, allowed):
        return PolicyDecision(status="auto_confirm")
    return PolicyDecision(
        status="pending",
        reason="reference host not in allow-list",
    )
