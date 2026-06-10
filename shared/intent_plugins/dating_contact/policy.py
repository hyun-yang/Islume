"""Dating plugin — owner policy schema + per-tool policy checks.

share_contact is UNCONDITIONALLY pending — no policy combination can
auto-share the owner's contact info. Offline-meeting proposals/acceptances
are person-to-person commitments and are always pending too; declining is
a non-event and auto-confirms.
"""

from __future__ import annotations

from shared.intent_plugins.base import PolicyDecision

POLICY_SCHEMA: dict = {
    "type": "object",
    "required": [],
    "properties": {
        "allowed_channels": {
            "type": "array",
            "items": {
                "type": "string",
                "enum": ["phone", "email", "instagram", "kakao", "line", "discord", "other"],
            },
        },
    },
    "additionalProperties": False,
}


def check_propose_offline_meeting(_args: dict, _policy: dict) -> PolicyDecision:
    return PolicyDecision(
        status="pending",
        reason="offline meeting proposals always require your approval",
    )


def check_accept_offline_meeting(_args: dict, _policy: dict) -> PolicyDecision:
    return PolicyDecision(
        status="pending",
        reason="accepting an offline meeting always requires your approval",
    )


def check_decline_offline_meeting(_args: dict, _policy: dict) -> PolicyDecision:
    return PolicyDecision(status="auto_confirm")


def check_share_contact(args: dict, policy: dict) -> PolicyDecision:
    allowed = policy.get("allowed_channels")
    channel = args.get("channel")
    if allowed and channel not in allowed:
        return PolicyDecision(
            status="auto_rejected",
            reason=f"channel {channel!r} not in allowed_channels",
        )
    # Never auto-confirm, regardless of policy.
    return PolicyDecision(
        status="pending",
        reason="sharing contact info always requires your approval",
    )
