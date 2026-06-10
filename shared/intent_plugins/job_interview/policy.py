"""Job interview plugin — owner policy schema + per-tool policy checks.

Interview requests and acceptances are ALWAYS pending: they are significant,
person-to-person commitments, so the owning user must approve them no matter
what the policy says. Declining is a non-event and auto-confirms.
"""

from __future__ import annotations

from shared.intent_plugins.base import PolicyDecision

POLICY_SCHEMA: dict = {
    "type": "object",
    "required": ["role"],
    "properties": {
        "role": {"type": "string", "enum": ["recruiter", "job_seeker"]},
        "position": {"type": "string", "minLength": 2, "maxLength": 120},
        "company": {"type": "string", "minLength": 2, "maxLength": 120},
    },
    "additionalProperties": False,
}


def check_request_interview(_args: dict, _policy: dict) -> PolicyDecision:
    return PolicyDecision(
        status="pending",
        reason="interview requests always require your approval",
    )


def check_accept_interview(_args: dict, _policy: dict) -> PolicyDecision:
    return PolicyDecision(
        status="pending",
        reason="accepting an interview always requires your approval",
    )


def check_decline_interview(_args: dict, _policy: dict) -> PolicyDecision:
    return PolicyDecision(status="auto_confirm")
