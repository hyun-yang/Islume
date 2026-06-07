"""Reusable policy_check helpers."""

from __future__ import annotations

from urllib.parse import urlparse

from shared.intent_plugins.base import PolicyDecision


def in_range(
    value: int | float, lo: int | float | None, hi: int | float | None
) -> bool:
    if lo is not None and value < lo:
        return False
    if hi is not None and value > hi:
        return False
    return True


def host_allowed(url: str, allowed_hosts: list[str] | None) -> bool:
    """Wildcard list semantics: None or ["*"] means anything; otherwise host must match.

    Hosts are matched case-insensitively. Subdomains are not auto-allowed; list them
    explicitly if you want them.
    """
    if not allowed_hosts or "*" in allowed_hosts:
        return True
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return False
    return host in {h.lower() for h in allowed_hosts}


def always_auto(_: dict, __: dict) -> PolicyDecision:
    return PolicyDecision(status="auto_confirm")
