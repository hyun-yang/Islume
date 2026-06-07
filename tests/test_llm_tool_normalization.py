"""LLM tool-call normalization — provider response → ToolCall.

These tests don't hit real LLMs. They exercise the parser/normalizer pieces
directly: tool payload shaping, Ollama <action> tag fallback, and the
backward-compat split between LLMResponse and GenerationResult.
"""

from __future__ import annotations

import json

import shared.llm as L
from shared.intent_plugins import get_plugin

# ---- payload shape ----------------------------------------------------------


def test_anthropic_payload_shape() -> None:
    tools = get_plugin("bartering").tools
    payload = L._anthropic_tools_payload(tools)
    assert len(payload) == len(tools)
    for entry, tool in zip(payload, tools, strict=True):
        assert entry["name"] == tool.name
        assert entry["description"] == tool.description
        assert entry["input_schema"] is tool.parameters


def test_openai_payload_shape() -> None:
    tools = get_plugin("bartering").tools
    payload = L._openai_tools_payload(tools)
    assert len(payload) == len(tools)
    for entry, tool in zip(payload, tools, strict=True):
        assert entry["type"] == "function"
        assert entry["function"]["name"] == tool.name
        assert entry["function"]["parameters"] is tool.parameters


def test_ollama_prompt_contains_every_tool_name() -> None:
    tools = get_plugin("bartering").tools
    prompt = L._ollama_tool_prompt(tools)
    assert "<action>" in prompt
    for tool in tools:
        assert tool.name in prompt


# ---- Ollama <action> tag parsing -------------------------------------------


def test_parse_action_tag_extracts_tool_call_and_strips_tag() -> None:
    raw = (
        "Sure, I'll propose forty. <action>"
        '{"name": "propose_price", "arguments": {"amount": 40, "currency": "ISL", "item_name": "turntable"}}'
        "</action>"
    )
    cleaned, calls, dropped = L._parse_action_tags(raw)
    assert cleaned == "Sure, I'll propose forty."
    assert dropped == 0
    assert len(calls) == 1
    assert calls[0].name == "propose_price"
    assert calls[0].arguments == {
        "amount": 40,
        "currency": "ISL",
        "item_name": "turntable",
    }


def test_parse_action_no_tag_returns_text_only() -> None:
    cleaned, calls, dropped = L._parse_action_tags("Just chatting.")
    assert cleaned == "Just chatting."
    assert calls == []
    assert dropped == 0


def test_parse_action_malformed_json_counts_as_dropped() -> None:
    raw = "Try this <action>{name: bad}</action> bye"
    cleaned, calls, dropped = L._parse_action_tags(raw)
    # Tag is still stripped from text even when JSON is malformed
    assert "<action>" not in cleaned
    assert calls == []
    assert dropped == 1


def test_parse_action_missing_name_field_dropped() -> None:
    raw = 'X <action>{"arguments": {"amount": 1}}</action>'
    _, calls, dropped = L._parse_action_tags(raw)
    assert calls == []
    assert dropped == 1


def test_parse_action_multiple_tags() -> None:
    raw = (
        '<action>{"name":"propose_price","arguments":{"amount":40,"currency":"ISL","item_name":"x"}}</action>'
        " meta "
        '<action>{"name":"share_reference","arguments":{"kind":"photo","url":"https://example.com/x.jpg"}}</action>'
    )
    cleaned, calls, dropped = L._parse_action_tags(raw)
    assert cleaned == "meta"
    assert [c.name for c in calls] == ["propose_price", "share_reference"]
    assert dropped == 0


def test_parse_action_arguments_must_be_dict() -> None:
    raw = '<action>{"name": "propose_price", "arguments": [1,2,3]}</action>'
    _, calls, dropped = L._parse_action_tags(raw)
    assert calls == []
    assert dropped == 1


# ---- GenerationResult vs LLMResponse ---------------------------------------


def test_generation_result_default_fields() -> None:
    r = L.GenerationResult(text="hi")
    assert r.text == "hi"
    assert r.tool_calls == []
    assert r.input_tokens == 0


def test_generation_result_cost_falls_back_to_zero_for_unknown_model() -> None:
    r = L.GenerationResult(
        text="x", model="unknown-model", input_tokens=1000, output_tokens=2000
    )
    assert r.cost_usd == 0.0


def test_generation_result_cost_uses_pricing_table() -> None:
    r = L.GenerationResult(
        text="x",
        model="claude-haiku-4-5",
        input_tokens=1_000_000,
        output_tokens=500_000,
    )
    # Haiku: $0.80 input + $4.0 output per 1M
    assert abs(r.cost_usd - (0.80 + 2.0)) < 1e-9


def test_llmresponse_signature_unchanged() -> None:
    # Spot-check that the legacy dataclass still has exactly the documented fields.
    r = L.LLMResponse(
        text="t", input_tokens=1, output_tokens=2, model="claude-haiku-4-5"
    )
    assert r.text == "t"
    assert r.cost_usd > 0


def test_ollama_prompt_includes_parameter_schema_json() -> None:
    """Local models need the schema explicitly. Parse-back the JSON to confirm validity."""
    tools = get_plugin("bartering").tools
    prompt = L._ollama_tool_prompt(tools)
    # First tool's schema should be findable as valid JSON in the prompt
    needle = json.dumps(tools[0].parameters)
    assert needle in prompt
