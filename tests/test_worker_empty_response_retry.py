"""Worker empty-response retry guard — `_generate_turn_reply`.

A reasoning model can return ``content=""`` (its whole output budget spent on
hidden reasoning tokens). The worker must not persist that empty turn: a blank
turn poisons the next turn's history and cascades empties to every following
turn (observed on gpt-5-mini from turn 16 onward). The guard retries once and
raises on a double-empty so the task is left in the PEL instead of stored.

DB-free: `generate` is monkeypatched and the async helper is driven via
`asyncio.run`, so no pytest-asyncio config is required.
"""

from __future__ import annotations

import asyncio
from uuid import UUID

import pytest

import services.worker.main as W
from shared.intent_plugins import ToolCall

_SID = UUID(int=1)


class _Resp:
    """Minimal stand-in for LLMResponse / GenerationResult."""

    def __init__(self, text: str, tool_calls: list[ToolCall] | None = None) -> None:
        self.text = text
        self.tool_calls = tool_calls or []


def _call(**over):
    kwargs = dict(
        system="s", messages=[], model="claude-haiku-4-5",
        tools=None, session_id=_SID, turn_number=5,
    )
    kwargs.update(over)
    return asyncio.run(W._generate_turn_reply(**kwargs))


def test_retries_once_and_returns_second_reply(monkeypatch) -> None:
    seq = [_Resp(""), _Resp("real reply")]
    calls: list[int] = []

    async def fake_generate(**_kwargs):
        calls.append(1)
        return seq[len(calls) - 1]

    monkeypatch.setattr(W, "generate", fake_generate)
    resp, tool_calls = _call()
    assert resp.text == "real reply"
    assert tool_calls == []
    assert len(calls) == 2  # retried exactly once


def test_raises_when_empty_twice(monkeypatch) -> None:
    calls: list[int] = []

    async def fake_generate(**_kwargs):
        calls.append(1)
        return _Resp("   ")  # whitespace-only counts as empty

    monkeypatch.setattr(W, "generate", fake_generate)
    with pytest.raises(RuntimeError, match="empty content twice"):
        _call(turn_number=16)
    assert len(calls) == 2  # one retry, then give up — no infinite loop


def test_no_retry_when_tool_call_present(monkeypatch) -> None:
    """Empty text WITH a tool call is a valid turn (model called a tool
    without speaking) — it must not trigger the retry."""
    calls: list[int] = []

    async def fake_generate(**_kwargs):
        calls.append(1)
        return _Resp("", tool_calls=[ToolCall(id="t1", name="share_contact", arguments={})])

    monkeypatch.setattr(W, "generate", fake_generate)
    resp, tool_calls = _call()
    assert len(calls) == 1  # accepted on first try
    assert len(tool_calls) == 1


def test_no_retry_when_first_reply_nonempty(monkeypatch) -> None:
    calls: list[int] = []

    async def fake_generate(**_kwargs):
        calls.append(1)
        return _Resp("hello there")

    monkeypatch.setattr(W, "generate", fake_generate)
    resp, _ = _call()
    assert resp.text == "hello there"
    assert len(calls) == 1
