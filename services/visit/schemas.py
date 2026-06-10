"""Pydantic request/response schemas for the Visit service."""
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class CreateVisitRequest(BaseModel):
    visitor_id: UUID
    host_id: UUID


class VisitResponse(BaseModel):
    id: UUID
    visitor_id: UUID
    host_id: UUID
    host_name: str
    status: str
    visitor_x: int | None
    visitor_y: int | None
    started_at: str
    arrived_at: str | None
    ended_at: str | None


class UpdateVisitRequest(BaseModel):
    visitor_x: int | None = None
    visitor_y: int | None = None
    status: str | None = None


class TerrainResponse(BaseModel):
    visit_id: UUID
    host_id: UUID
    island_seed: int
    house_x: int | None
    house_y: int | None
    map_size: int = 128
    tile_size: int = 32


class CreateMessageRequest(BaseModel):
    sender_id: UUID
    content: str = Field(..., min_length=1, max_length=2000)


class MessageResponse(BaseModel):
    id: UUID
    visit_session_id: UUID
    sender_id: UUID
    sender_name: str
    content: str
    created_at: str


class MessageListResponse(BaseModel):
    messages: list[MessageResponse]
    total: int


# Voxel map schemas

class VoxelMapResponse(BaseModel):
    island_id: UUID
    version: int
    voxel_data_b64: str
    heightmap_b64: str | None


class VoxelMapSaveRequest(BaseModel):
    voxel_data_b64: str
    heightmap_b64: str | None = None


class BlockChange(BaseModel):
    x: int
    y: int
    z: int
    block: int


class BlockUpdateRequest(BaseModel):
    changes: list[BlockChange]


# Island stage schemas (user-authored platformer levels)
#
# Validation rules here mirror frontend/lib/platformer/levelValidation.ts —
# keep both rule lists in sync when changing either side.

STAGE_HEIGHT = 16
STAGE_MIN_WIDTH = 40
STAGE_MAX_WIDTH = 200
STAGE_MAX_ACTORS = 32
STAGE_MAX_CHECKPOINTS = 4

# Single-char legend from frontend/lib/platformer/types.ts TILE_LEGEND
STAGE_LEGEND_CHARS = set(".GDPBWSRFTcu")
STAGE_SOLID_CHARS = set("GDBSR")

StageActorType = Literal[
    "enemy_crab",
    "enemy_starfish",
    "enemy_frog",
    "platform_log",
    "platform_lily",
    "whale",
    "enemy_bear_boss",
    "npc_tani",
    "item_shell",
    "item_heart",
    "item_banana",
    "item_pineapple",
    "block_coconut",
]


class TilePoint(BaseModel):
    x: int
    y: int


class StageActor(BaseModel):
    id: str = Field(min_length=1, max_length=16)
    type: StageActorType
    x: int
    y: int
    walk_range: tuple[int, int] | None = None
    jump_interval_ms: int | None = Field(default=None, ge=200, le=60_000)
    dialog: list[str] | None = Field(default=None, max_length=8)
    drop: StageActorType | None = None


class StageLevelData(BaseModel):
    background: Literal["beach", "stream", "forest"]
    rows: list[str]
    spawn: TilePoint
    goal: TilePoint
    actors: list[StageActor] = []
    checkpoints: list[TilePoint] = []

    @model_validator(mode="after")
    def _validate_level(self) -> "StageLevelData":
        if len(self.rows) != STAGE_HEIGHT:
            raise ValueError(f"level must have exactly {STAGE_HEIGHT} rows")
        width = len(self.rows[0])
        if not STAGE_MIN_WIDTH <= width <= STAGE_MAX_WIDTH:
            raise ValueError(
                f"width must be {STAGE_MIN_WIDTH}-{STAGE_MAX_WIDTH} tiles, got {width}"
            )
        for y, row in enumerate(self.rows):
            if len(row) != width:
                raise ValueError(f"row {y} length {len(row)}, expected {width}")
            bad = set(row) - STAGE_LEGEND_CHARS
            if bad:
                raise ValueError(f"row {y} has unknown tile chars: {sorted(bad)}")

        def in_bounds(p: TilePoint) -> bool:
            return 0 <= p.x < width and 0 <= p.y < STAGE_HEIGHT

        if not in_bounds(self.spawn):
            raise ValueError("spawn out of bounds")
        if not in_bounds(self.goal):
            raise ValueError("goal out of bounds")
        # Spawn coords mean "the tile the player stands on" (bottom anchor),
        # so the spawn tile itself may be solid — but the player body above
        # it (~2 tiles tall) must not be inside a wall.
        for dy in (1, 2):
            by = self.spawn.y - dy
            if by >= 0 and self.rows[by][self.spawn.x] in STAGE_SOLID_CHARS:
                raise ValueError("spawn has no headroom (solid tile above spawn)")

        # The engine's clear check is overlap with a flag-pole tile — a stage
        # without one is unclearable, and therefore unpublishable.
        if not any("F" in row for row in self.rows):
            raise ValueError("level needs at least one flag pole (F) tile")

        if len(self.actors) > STAGE_MAX_ACTORS:
            raise ValueError(f"too many actors (max {STAGE_MAX_ACTORS})")
        seen_ids: set[str] = set()
        for a in self.actors:
            if a.id in seen_ids:
                raise ValueError(f"duplicate actor id: {a.id}")
            seen_ids.add(a.id)
            if not (0 <= a.x < width and 0 <= a.y < STAGE_HEIGHT):
                raise ValueError(f"actor {a.id} out of bounds")
            if a.walk_range is not None:
                lo, hi = a.walk_range
                if not (0 <= lo <= hi < width):
                    raise ValueError(f"actor {a.id} walk_range out of bounds")
        for kind in ("enemy_bear_boss", "npc_tani"):
            if sum(1 for a in self.actors if a.type == kind) > 1:
                raise ValueError(f"at most one {kind} allowed")

        if len(self.checkpoints) > STAGE_MAX_CHECKPOINTS:
            raise ValueError(f"too many checkpoints (max {STAGE_MAX_CHECKPOINTS})")
        for cp in self.checkpoints:
            if not in_bounds(cp):
                raise ValueError("checkpoint out of bounds")
        return self


class StageSaveRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    level_data: StageLevelData


class StageResponse(BaseModel):
    slot: int
    status: str
    cleared: bool
    name: str
    level_data: dict
    updated_at: str


class StageListResponse(BaseModel):
    stages: list[StageResponse]
