"""Agent create/update schemas — attached_plugins validation and round-trip."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from services.matching.schemas import AgentCreate, AgentUpdate

BASE_CREATE = {
    "name": "Tester",
    "description": "desc",
    "persona_prompt": "talks plainly",
}


def test_create_accepts_known_plugin_and_round_trips() -> None:
    body = AgentCreate(
        **BASE_CREATE,
        attached_plugins=[
            {"plugin": "bartering", "policy": {"min_price": 10, "max_price": 50}}
        ],
    )
    assert body.attached_plugins is not None
    dumped = [e.model_dump() for e in body.attached_plugins]
    assert dumped == [
        {"plugin": "bartering", "policy": {"min_price": 10, "max_price": 50}}
    ]


def test_create_policy_defaults_to_empty_dict() -> None:
    body = AgentCreate(**BASE_CREATE, attached_plugins=[{"plugin": "dating_contact"}])
    assert body.attached_plugins is not None
    assert body.attached_plugins[0].policy == {}


def test_create_rejects_unknown_plugin_id() -> None:
    with pytest.raises(ValidationError, match="unknown plugin id"):
        AgentCreate(**BASE_CREATE, attached_plugins=[{"plugin": "nope", "policy": {}}])


def test_update_rejects_unknown_plugin_id() -> None:
    with pytest.raises(ValidationError, match="unknown plugin id"):
        AgentUpdate(attached_plugins=[{"plugin": "nope", "policy": {}}])


def test_create_omitted_and_null_stay_none() -> None:
    assert AgentCreate(**BASE_CREATE).attached_plugins is None
    assert AgentCreate(**BASE_CREATE, attached_plugins=None).attached_plugins is None


def test_update_explicit_null_survives_exclude_unset() -> None:
    # Unchecking every plugin in the UI sends attached_plugins: null — the
    # update endpoint must see it in model_dump(exclude_unset=True) to clear
    # the column.
    updates = AgentUpdate(attached_plugins=None).model_dump(exclude_unset=True)
    assert updates == {"attached_plugins": None}


def test_update_entries_dump_to_plain_dicts() -> None:
    # update_agent setattr's model_dump output straight onto the JSONB column.
    updates = AgentUpdate(
        attached_plugins=[{"plugin": "job_interview", "policy": {}}]
    ).model_dump(exclude_unset=True)
    assert updates == {
        "attached_plugins": [{"plugin": "job_interview", "policy": {}}]
    }
