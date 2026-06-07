"""Pydantic request/response schemas for the Visit service."""
from uuid import UUID

from pydantic import BaseModel, Field


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
