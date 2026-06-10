"""Intent plugin registry — MCP-style.

Plugins are registered here explicitly so mypy can see all of them at import time.
Third-party plugins can call `register(plugin)` at their own import time and the host
process can opt them in via an env var (future work).
"""

from __future__ import annotations

from shared.intent_plugins.bartering import plugin as _bartering
from shared.intent_plugins.base import (
    ChatEventSpec,
    HandlerResult,
    Plugin,
    PolicyDecision,
    PolicyStatus,
    ToolCall,
    ToolDef,
    ToolHandler,
    validate_arguments,
)
from shared.intent_plugins.job_interview import plugin as _job_interview

PLUGINS: dict[str, Plugin] = {
    _bartering.id: _bartering,
    _job_interview.id: _job_interview,
}


def get_plugin(plugin_id: str) -> Plugin | None:
    return PLUGINS.get(plugin_id)


def all_plugin_ids() -> list[str]:
    return list(PLUGINS.keys())


def register(plugin: Plugin) -> None:
    """Used by third-party plugins. Raises if the id collides."""
    if plugin.id in PLUGINS:
        raise ValueError(f"plugin id already registered: {plugin.id}")
    PLUGINS[plugin.id] = plugin


__all__ = [
    "PLUGINS",
    "ChatEventSpec",
    "HandlerResult",
    "Plugin",
    "PolicyDecision",
    "PolicyStatus",
    "ToolCall",
    "ToolDef",
    "ToolHandler",
    "all_plugin_ids",
    "get_plugin",
    "register",
    "validate_arguments",
]
