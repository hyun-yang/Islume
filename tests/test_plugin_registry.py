"""Plugin registry — base type sanity + bartering registration."""

from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from shared.intent_plugins import (
    PLUGINS,
    Plugin,
    PolicyDecision,
    ToolCall,
    all_plugin_ids,
    get_plugin,
    register,
    validate_arguments,
)
from shared.intent_plugins.bartering import plugin as bartering_plugin


def test_bartering_registered_by_default() -> None:
    assert "bartering" in PLUGINS
    assert "bartering" in all_plugin_ids()
    p = get_plugin("bartering")
    assert p is bartering_plugin
    assert p.card_kind == "bartering"


def test_bartering_has_six_tools() -> None:
    p = get_plugin("bartering")
    names = sorted(t.name for t in p.tools)
    assert names == [
        "accept_offer",
        "counter_offer",
        "propose_price",
        "reject_offer",
        "share_reference",
        "withdraw",
    ]


def test_tools_have_well_formed_parameter_schemas() -> None:
    p = get_plugin("bartering")
    for tool in p.tools:
        assert isinstance(tool.parameters, dict)
        assert tool.parameters.get("type") == "object"
        assert "properties" in tool.parameters


def test_policy_schema_is_object_with_required() -> None:
    p = get_plugin("bartering")
    schema = p.policy_schema
    assert schema.get("type") == "object"
    assert {"role", "item_name", "currency", "price_range"}.issubset(
        schema.get("required", [])
    )


def test_prompt_fragment_returns_str() -> None:
    p = get_plugin("bartering")
    out = p.prompt_fragment(
        {
            "role": "seller",
            "item_name": "vintage Polaroid",
            "currency": "ISL",
            "price_range": {"min": 30, "max": 60},
            "auto_accept_at_or_above": 55,
            "auto_reject_below": 25,
        },
        "seller",
    )
    assert isinstance(out, str)
    assert "Bartering" in out
    assert "vintage Polaroid" in out
    assert "30" in out and "60" in out


def test_handlers_cover_every_tool() -> None:
    p = get_plugin("bartering")
    tool_names = {t.name for t in p.tools}
    handler_names = set(p.handlers.keys())
    assert tool_names == handler_names


def test_register_rejects_duplicates() -> None:
    p = get_plugin("bartering")
    with pytest.raises(ValueError):
        register(p)


def test_register_accepts_new_plugin() -> None:
    fake = Plugin(
        id="__test_only__",
        tools=[],
        policy_schema={"type": "object"},
        prompt_fragment=lambda _p, _r: "",
        handlers={},
        card_kind="__test_only__",
    )
    try:
        register(fake)
        assert "__test_only__" in PLUGINS
    finally:
        # cleanup so test ordering doesn't matter
        PLUGINS.pop("__test_only__", None)


def test_validate_arguments_required_and_unknown() -> None:
    p = get_plugin("bartering")
    propose = p.tool_by_name("propose_price")
    assert propose is not None
    ok, _ = validate_arguments(
        propose, {"amount": 40, "currency": "ISL", "item_name": "x"}
    )
    assert ok
    ok, reason = validate_arguments(propose, {"currency": "ISL", "item_name": "x"})
    assert not ok and "amount" in reason
    ok, reason = validate_arguments(
        propose, {"amount": 40, "currency": "ISL", "item_name": "x", "bogus": 1}
    )
    assert not ok and "bogus" in reason


def test_validate_arguments_type_mismatch() -> None:
    p = get_plugin("bartering")
    propose = p.tool_by_name("propose_price")
    assert propose is not None
    ok, reason = validate_arguments(
        propose, {"amount": "forty", "currency": "ISL", "item_name": "x"}
    )
    assert not ok and "integer" in reason


def test_tool_call_dataclass_frozen() -> None:
    tc = ToolCall(id="x", name="propose_price", arguments={"a": 1})
    assert tc.id == "x"
    # ToolCall is frozen — assignment should raise
    with pytest.raises(FrozenInstanceError):
        tc.id = "y"  # type: ignore[misc]


def test_tooldef_frozen() -> None:
    p = get_plugin("bartering")
    tool = p.tools[0]
    with pytest.raises(FrozenInstanceError):
        tool.name = "renamed"  # type: ignore[misc]


def test_policy_decision_statuses() -> None:
    for status in ("auto_confirm", "pending", "auto_rejected"):
        d = PolicyDecision(status=status)  # type: ignore[arg-type]
        assert d.status == status
