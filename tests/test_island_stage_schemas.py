"""Island stage level-data validation — schema rules and built-in round-trip."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from services.visit.schemas import (
    STAGE_HEIGHT,
    StageLevelData,
    StageSaveRequest,
)

STAGE1_JSON = (
    Path(__file__).resolve().parents[1]
    / "frontend"
    / "lib"
    / "platformer"
    / "levels"
    / "stage1.json"
)


def _flat_level(width: int = 64, **overrides: object) -> dict:
    """A minimal valid level: flat ground floor, spawn on it, flag near the end."""
    empty = "." * width
    flag_x = width - 4
    flag_top = "." * flag_x + "T" + "." * (width - flag_x - 1)
    flag_pole = "." * flag_x + "F" + "." * (width - flag_x - 1)
    ground = "G" * width
    dirt = "D" * width
    rows = (
        [empty] * (STAGE_HEIGHT - 6)
        + [flag_top, flag_pole, flag_pole]
        + [ground, dirt, dirt]
    )
    level: dict = {
        "background": "beach",
        "rows": rows,
        "spawn": {"x": 2, "y": STAGE_HEIGHT - 4},
        "goal": {"x": flag_x, "y": STAGE_HEIGHT - 4},
        "actors": [],
        "checkpoints": [],
    }
    level.update(overrides)
    return level


def test_valid_level_round_trips() -> None:
    data = StageLevelData(**_flat_level())
    dumped = data.model_dump(exclude_none=True)
    assert dumped["rows"] == _flat_level()["rows"]
    assert StageLevelData(**dumped).spawn.x == 2


def test_builtin_stage1_passes_validation() -> None:
    """Guards against the validator drifting from the actual level format."""
    raw = json.loads(STAGE1_JSON.read_text())
    data = StageLevelData(**raw)  # extra id/name keys are ignored by pydantic
    assert data.background == "beach"
    assert len(data.rows) == STAGE_HEIGHT


def test_save_request_name_bounds() -> None:
    StageSaveRequest(name="A", level_data=_flat_level())
    with pytest.raises(ValidationError):
        StageSaveRequest(name="", level_data=_flat_level())
    with pytest.raises(ValidationError):
        StageSaveRequest(name="x" * 65, level_data=_flat_level())


@pytest.mark.parametrize("height", [15, 17])
def test_rejects_wrong_height(height: int) -> None:
    level = _flat_level()
    level["rows"] = level["rows"][:height] + ["." * 64] * max(0, height - 16)
    level["rows"] = level["rows"][:height]
    with pytest.raises(ValidationError, match="rows"):
        StageLevelData(**level)


@pytest.mark.parametrize("width", [39, 201])
def test_rejects_out_of_range_width(width: int) -> None:
    with pytest.raises(ValidationError, match="width"):
        StageLevelData(**_flat_level(width=width))


def test_rejects_ragged_rows() -> None:
    level = _flat_level()
    level["rows"][5] = level["rows"][5] + "."
    with pytest.raises(ValidationError, match="length"):
        StageLevelData(**level)


def test_rejects_unknown_tile_char() -> None:
    level = _flat_level()
    level["rows"][0] = "X" + level["rows"][0][1:]
    with pytest.raises(ValidationError, match="unknown tile"):
        StageLevelData(**level)


def test_rejects_spawn_out_of_bounds() -> None:
    with pytest.raises(ValidationError, match="spawn out of bounds"):
        StageLevelData(**_flat_level(spawn={"x": 64, "y": 5}))


def test_rejects_goal_out_of_bounds() -> None:
    with pytest.raises(ValidationError, match="goal out of bounds"):
        StageLevelData(**_flat_level(goal={"x": 2, "y": -1}))


def test_rejects_spawn_without_headroom() -> None:
    level = _flat_level()
    # Solid brick directly above the spawn tile traps the player in a wall.
    y = level["spawn"]["y"] - 1
    x = level["spawn"]["x"]
    row = level["rows"][y]
    level["rows"][y] = row[:x] + "B" + row[x + 1 :]
    with pytest.raises(ValidationError, match="headroom"):
        StageLevelData(**level)


def test_rejects_level_without_flag_pole() -> None:
    level = _flat_level()
    level["rows"] = [row.replace("F", ".").replace("T", ".") for row in level["rows"]]
    with pytest.raises(ValidationError, match="flag pole"):
        StageLevelData(**level)


def test_rejects_too_many_actors() -> None:
    actors = [
        {"id": f"a{i}", "type": "item_shell", "x": 2 + i % 30, "y": 5}
        for i in range(33)
    ]
    with pytest.raises(ValidationError, match="too many actors"):
        StageLevelData(**_flat_level(actors=actors))


def test_rejects_duplicate_actor_ids() -> None:
    actors = [
        {"id": "dup", "type": "item_shell", "x": 2, "y": 5},
        {"id": "dup", "type": "item_heart", "x": 3, "y": 5},
    ]
    with pytest.raises(ValidationError, match="duplicate actor id"):
        StageLevelData(**_flat_level(actors=actors))


def test_rejects_actor_out_of_bounds() -> None:
    actors = [{"id": "c1", "type": "enemy_crab", "x": 64, "y": 5}]
    with pytest.raises(ValidationError, match="out of bounds"):
        StageLevelData(**_flat_level(actors=actors))


def test_rejects_unknown_actor_type() -> None:
    actors = [{"id": "z1", "type": "enemy_dragon", "x": 2, "y": 5}]
    with pytest.raises(ValidationError):
        StageLevelData(**_flat_level(actors=actors))


def test_rejects_two_bosses() -> None:
    actors = [
        {"id": "b1", "type": "enemy_bear_boss", "x": 10, "y": 12},
        {"id": "b2", "type": "enemy_bear_boss", "x": 20, "y": 12},
    ]
    with pytest.raises(ValidationError, match="at most one enemy_bear_boss"):
        StageLevelData(**_flat_level(actors=actors))


def test_rejects_two_npcs() -> None:
    actors = [
        {"id": "n1", "type": "npc_tani", "x": 10, "y": 12},
        {"id": "n2", "type": "npc_tani", "x": 20, "y": 12},
    ]
    with pytest.raises(ValidationError, match="at most one npc_tani"):
        StageLevelData(**_flat_level(actors=actors))


def test_rejects_walk_range_out_of_bounds() -> None:
    actors = [
        {"id": "c1", "type": "enemy_crab", "x": 10, "y": 12, "walk_range": [5, 64]}
    ]
    with pytest.raises(ValidationError, match="walk_range"):
        StageLevelData(**_flat_level(actors=actors))


def test_rejects_checkpoint_out_of_bounds() -> None:
    with pytest.raises(ValidationError, match="checkpoint"):
        StageLevelData(**_flat_level(checkpoints=[{"x": 70, "y": 5}]))
