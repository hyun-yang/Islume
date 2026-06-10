"""REST endpoints for the Visit service."""
from __future__ import annotations

import random
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import func as sa_func
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from services.visit import rps as rps_logic
from services.visit.schemas import (
    BlockUpdateRequest,
    CreateMessageRequest,
    CreateVisitRequest,
    MessageListResponse,
    MessageResponse,
    StageListResponse,
    StageResponse,
    StageSaveRequest,
    TerrainResponse,
    UpdateVisitRequest,
    VisitResponse,
    VoxelMapResponse,
    VoxelMapSaveRequest,
)
from services.visit.user_events import publish_user_event
from shared.db import get_sessionmaker
from shared.models import (
    DirectMessage,
    IslandMapEdit,
    IslandStage,
    IslandTiledMap,
    IslandVoxelMap,
    User,
    VisitSession,
)
from shared.redis_client import get_redis

router = APIRouter()


async def get_session() -> AsyncSession:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as s:
        yield s


def _visit_to_response(v: VisitSession, host_name: str) -> VisitResponse:
    return VisitResponse(
        id=v.id,
        visitor_id=v.visitor_id,
        host_id=v.host_id,
        host_name=host_name,
        status=v.status,
        visitor_x=v.visitor_x,
        visitor_y=v.visitor_y,
        started_at=v.started_at.isoformat(),
        arrived_at=v.arrived_at.isoformat() if v.arrived_at else None,
        ended_at=v.ended_at.isoformat() if v.ended_at else None,
    )


async def _ensure_island_seed(db: AsyncSession, host: User) -> int:
    """Assign a random island_seed on first use. Returns the seed."""
    if host.island_seed is None:
        host.island_seed = random.randint(1, 2_147_483_647)  # nosec B311  # game map seed, not security-sensitive
        await db.flush()
    return host.island_seed


@router.post("/visits", response_model=VisitResponse, status_code=201)
async def create_visit(
    body: CreateVisitRequest, db: AsyncSession = Depends(get_session)
):
    if body.visitor_id == body.host_id:
        raise HTTPException(status_code=422, detail="Cannot visit your own island")

    visitor = await db.get(User, body.visitor_id)
    if not visitor:
        raise HTTPException(status_code=404, detail="Visitor not found")
    host = await db.get(User, body.host_id)
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")

    await _ensure_island_seed(db, host)

    existing = await db.execute(
        select(VisitSession).where(
            VisitSession.visitor_id == body.visitor_id,
            VisitSession.host_id == body.host_id,
            VisitSession.status != "ended",
        )
    )
    current = existing.scalar_one_or_none()
    if current:
        await db.commit()
        return _visit_to_response(current, host.display_name)

    visit = VisitSession(
        visitor_id=body.visitor_id,
        host_id=body.host_id,
        status="active",
    )
    db.add(visit)
    await db.commit()
    await db.refresh(visit)

    r = get_redis()
    await r.set(f"visit:active:{body.host_id}", str(visit.id))

    await publish_user_event(
        host.id,
        "visit:incoming",
        {
            "visit_id": str(visit.id),
            "visitor_id": str(visitor.id),
            "visitor_name": visitor.display_name,
            "started_at": visit.started_at.isoformat() if visit.started_at else "",
        },
    )

    return _visit_to_response(visit, host.display_name)


@router.get("/visits/{visit_id}", response_model=VisitResponse)
async def get_visit(visit_id: UUID, db: AsyncSession = Depends(get_session)):
    visit = await db.get(VisitSession, visit_id)
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    host = await db.get(User, visit.host_id)
    return _visit_to_response(visit, host.display_name if host else "")


@router.patch("/visits/{visit_id}", response_model=VisitResponse)
async def update_visit(
    visit_id: UUID,
    body: UpdateVisitRequest,
    db: AsyncSession = Depends(get_session),
):
    visit = await db.get(VisitSession, visit_id)
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    if visit.status == "ended":
        raise HTTPException(status_code=409, detail="Visit already ended")

    if body.visitor_x is not None:
        visit.visitor_x = body.visitor_x
    if body.visitor_y is not None:
        visit.visitor_y = body.visitor_y

    status_changed_to_arrived = False
    status_changed_to_ended = False
    if body.status is not None:
        if body.status not in ("active", "arrived", "ended"):
            raise HTTPException(status_code=422, detail="Invalid status")
        prev_status = visit.status
        visit.status = body.status
        if body.status == "arrived" and visit.arrived_at is None:
            visit.arrived_at = datetime.utcnow()
            status_changed_to_arrived = prev_status != "arrived"
        if body.status == "ended" and visit.ended_at is None:
            visit.ended_at = datetime.utcnow()
            status_changed_to_ended = prev_status != "ended"

    await db.commit()
    await db.refresh(visit)
    host = await db.get(User, visit.host_id)
    visitor = await db.get(User, visit.visitor_id)
    if status_changed_to_arrived and visitor is not None:
        await publish_user_event(
            visit.host_id,
            "visit:arrived",
            {
                "visit_id": str(visit.id),
                "visitor_id": str(visitor.id),
                "visitor_name": visitor.display_name,
            },
        )
    if status_changed_to_ended:
        for uid in (visit.visitor_id, visit.host_id):
            await publish_user_event(uid, "visit:ended", {"visit_id": str(visit.id)})
    return _visit_to_response(visit, host.display_name if host else "")


@router.delete("/visits/{visit_id}", response_model=VisitResponse)
async def end_visit(visit_id: UUID, db: AsyncSession = Depends(get_session)):
    visit = await db.get(VisitSession, visit_id)
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    became_ended = False
    if visit.status != "ended":
        visit.status = "ended"
        visit.ended_at = datetime.utcnow()
        await db.commit()
        await db.refresh(visit)
        became_ended = True

    r = get_redis()
    await r.delete(f"visit:active:{visit.host_id}")

    if became_ended:
        for uid in (visit.visitor_id, visit.host_id):
            await publish_user_event(uid, "visit:ended", {"visit_id": str(visit.id)})

    host = await db.get(User, visit.host_id)
    return _visit_to_response(visit, host.display_name if host else "")


@router.get("/visits/{visit_id}/terrain", response_model=TerrainResponse)
async def get_terrain(visit_id: UUID, db: AsyncSession = Depends(get_session)):
    visit = await db.get(VisitSession, visit_id)
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    host = await db.get(User, visit.host_id)
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")

    seed = await _ensure_island_seed(db, host)
    await db.commit()

    return TerrainResponse(
        visit_id=visit.id,
        host_id=host.id,
        island_seed=seed,
        house_x=host.house_x,
        house_y=host.house_y,
    )


@router.put("/users/{user_id}/house", response_model=TerrainResponse)
async def set_house_location(
    user_id: UUID,
    x: int = Query(..., ge=0, lt=128),
    y: int = Query(..., ge=0, lt=128),
    db: AsyncSession = Depends(get_session),
):
    """Client-reported house position (computed from seed). Stored for consistency."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.house_x is None:
        user.house_x = x
        user.house_y = y
        await db.commit()
    return TerrainResponse(
        visit_id=UUID(int=0),
        host_id=user.id,
        island_seed=user.island_seed or 0,
        house_x=user.house_x,
        house_y=user.house_y,
    )


@router.post(
    "/visits/{visit_id}/messages",
    response_model=MessageResponse,
    status_code=201,
)
async def create_message(
    visit_id: UUID,
    body: CreateMessageRequest,
    db: AsyncSession = Depends(get_session),
):
    visit = await db.get(VisitSession, visit_id)
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    if visit.status == "ended":
        raise HTTPException(status_code=409, detail="Visit already ended")
    if visit.status != "arrived":
        raise HTTPException(
            status_code=403, detail="Chat locked — visitor has not reached the house"
        )
    if body.sender_id not in (visit.visitor_id, visit.host_id):
        raise HTTPException(status_code=403, detail="Sender not in this visit")

    sender = await db.get(User, body.sender_id)
    if not sender:
        raise HTTPException(status_code=404, detail="Sender not found")

    msg = DirectMessage(
        visit_session_id=visit_id,
        sender_id=body.sender_id,
        content=body.content,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    r = get_redis()
    stream_key = f"stream:dm:{visit_id}"
    await r.xadd(
        stream_key,
        {
            "id": str(msg.id),
            "visit_session_id": str(visit_id),
            "sender_id": str(body.sender_id),
            "sender_name": sender.display_name,
            "content": body.content,
            "created_at": msg.created_at.isoformat(),
        },
    )

    # Per-user notification — receiver only.
    receiver_id = visit.host_id if body.sender_id == visit.visitor_id else visit.visitor_id
    preview = body.content if len(body.content) <= 80 else body.content[:77] + "..."
    await publish_user_event(
        receiver_id,
        "dm:received",
        {
            "visit_id": str(visit_id),
            "sender_id": str(body.sender_id),
            "sender_name": sender.display_name,
            "preview": preview,
        },
    )

    return MessageResponse(
        id=msg.id,
        visit_session_id=visit_id,
        sender_id=body.sender_id,
        sender_name=sender.display_name,
        content=body.content,
        created_at=msg.created_at.isoformat(),
    )


@router.get("/visits/{visit_id}/messages", response_model=MessageListResponse)
async def list_messages(
    visit_id: UUID,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_session),
):
    visit = await db.get(VisitSession, visit_id)
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")

    count_stmt = (
        select(sa_func.count())
        .select_from(DirectMessage)
        .where(DirectMessage.visit_session_id == visit_id)
    )
    total = (await db.execute(count_stmt)).scalar_one()

    stmt = (
        select(DirectMessage, User.display_name)
        .join(User, User.id == DirectMessage.sender_id)
        .where(DirectMessage.visit_session_id == visit_id)
        .order_by(DirectMessage.created_at)
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)

    messages = [
        MessageResponse(
            id=msg.id,
            visit_session_id=visit_id,
            sender_id=msg.sender_id,
            sender_name=name,
            content=msg.content,
            created_at=msg.created_at.isoformat(),
        )
        for msg, name in result.all()
    ]
    return MessageListResponse(messages=messages, total=total)


# ── Voxel Map Endpoints ──


@router.get("/islands/{user_id}/voxel-map", response_model=VoxelMapResponse)
async def get_voxel_map(user_id: UUID, db: AsyncSession = Depends(get_session)):
    stmt = select(IslandVoxelMap).where(IslandVoxelMap.island_id == user_id)
    result = await db.execute(stmt)
    vmap = result.scalar_one_or_none()
    if not vmap:
        raise HTTPException(status_code=404, detail="No voxel map found")

    import base64
    return VoxelMapResponse(
        island_id=vmap.island_id,
        version=vmap.version,
        voxel_data_b64=base64.b64encode(vmap.voxel_data).decode(),
        heightmap_b64=base64.b64encode(vmap.heightmap).decode() if vmap.heightmap else None,
    )


@router.put("/islands/{user_id}/voxel-map", response_model=VoxelMapResponse)
async def save_voxel_map(
    user_id: UUID,
    body: VoxelMapSaveRequest,
    db: AsyncSession = Depends(get_session),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    import base64
    voxel_data = base64.b64decode(body.voxel_data_b64)
    heightmap = base64.b64decode(body.heightmap_b64) if body.heightmap_b64 else None

    stmt = select(IslandVoxelMap).where(IslandVoxelMap.island_id == user_id)
    result = await db.execute(stmt)
    vmap = result.scalar_one_or_none()

    if vmap:
        vmap.voxel_data = voxel_data
        vmap.heightmap = heightmap
        vmap.version += 1
    else:
        vmap = IslandVoxelMap(
            island_id=user_id,
            voxel_data=voxel_data,
            heightmap=heightmap,
        )
        db.add(vmap)

    await db.commit()
    await db.refresh(vmap)

    return VoxelMapResponse(
        island_id=vmap.island_id,
        version=vmap.version,
        voxel_data_b64=base64.b64encode(vmap.voxel_data).decode(),
        heightmap_b64=base64.b64encode(vmap.heightmap).decode() if vmap.heightmap else None,
    )


@router.post("/islands/{user_id}/voxel-map/edits", status_code=201)
async def record_map_edit(
    user_id: UUID,
    body: BlockUpdateRequest,
    editor_id: UUID = Query(...),
    db: AsyncSession = Depends(get_session),
):
    edit = IslandMapEdit(
        island_id=user_id,
        editor_id=editor_id,
        changes={"changes": [c.model_dump() for c in body.changes]},
    )
    db.add(edit)
    await db.commit()
    return {"status": "ok"}


# ── Tiled Map Endpoints ──


@router.get("/islands/{user_id}/maps")
async def list_tiled_maps(user_id: UUID, db: AsyncSession = Depends(get_session)):
    stmt = select(IslandTiledMap).where(IslandTiledMap.island_id == user_id)
    result = await db.execute(stmt)
    maps = result.scalars().all()
    return [{"map_key": m.map_key, "version": m.version} for m in maps]


@router.get("/islands/{user_id}/maps/{map_key}")
async def get_tiled_map(user_id: UUID, map_key: str, db: AsyncSession = Depends(get_session)):
    stmt = select(IslandTiledMap).where(
        IslandTiledMap.island_id == user_id,
        IslandTiledMap.map_key == map_key,
    )
    result = await db.execute(stmt)
    tmap = result.scalar_one_or_none()
    if not tmap:
        raise HTTPException(status_code=404, detail="Map not found")
    return tmap.map_data


@router.put("/islands/{user_id}/maps/{map_key}")
async def save_tiled_map(
    user_id: UUID,
    map_key: str,
    body: dict,
    db: AsyncSession = Depends(get_session),
):
    stmt = select(IslandTiledMap).where(
        IslandTiledMap.island_id == user_id,
        IslandTiledMap.map_key == map_key,
    )
    result = await db.execute(stmt)
    tmap = result.scalar_one_or_none()

    if tmap:
        tmap.map_data = body
        tmap.version += 1
    else:
        tmap = IslandTiledMap(
            island_id=user_id,
            map_key=map_key,
            map_data=body,
        )
        db.add(tmap)

    await db.commit()
    return {"status": "ok", "version": tmap.version}


# ── Island Stage Endpoints ──
#
# User-authored platformer stages (max 3 slots per island). State machine:
# PUT always resets to draft/uncleared (editing a published stage
# auto-unpublishes it), publish requires cleared — so a published stage with
# unverified edits cannot exist. Visitors query with ?published=true and
# fall back to the built-in stages client-side when the list is empty.


def _stage_to_response(s: IslandStage) -> StageResponse:
    return StageResponse(
        slot=s.slot,
        status=s.status,
        cleared=s.cleared,
        name=s.name,
        level_data=s.level_data,
        updated_at=s.updated_at.isoformat(),
    )


async def _get_stage(db: AsyncSession, user_id: UUID, slot: int) -> IslandStage:
    stmt = select(IslandStage).where(
        IslandStage.island_id == user_id,
        IslandStage.slot == slot,
    )
    result = await db.execute(stmt)
    stage = result.scalar_one_or_none()
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    return stage


@router.get("/islands/{user_id}/stages", response_model=StageListResponse)
async def list_island_stages(
    user_id: UUID,
    published: bool = Query(False),
    db: AsyncSession = Depends(get_session),
):
    stmt = select(IslandStage).where(IslandStage.island_id == user_id)
    if published:
        stmt = stmt.where(IslandStage.status == "published")
    stmt = stmt.order_by(IslandStage.slot)
    result = await db.execute(stmt)
    stages = result.scalars().all()
    return StageListResponse(stages=[_stage_to_response(s) for s in stages])


@router.put("/islands/{user_id}/stages/{slot}", response_model=StageResponse)
async def save_island_stage(
    user_id: UUID,
    body: StageSaveRequest,
    slot: int = Path(ge=1, le=3),
    db: AsyncSession = Depends(get_session),
):
    stmt = select(IslandStage).where(
        IslandStage.island_id == user_id,
        IslandStage.slot == slot,
    )
    result = await db.execute(stmt)
    stage = result.scalar_one_or_none()

    level_data = body.level_data.model_dump(exclude_none=True)
    if stage:
        stage.name = body.name
        stage.level_data = level_data
        stage.cleared = False
        stage.status = "draft"
    else:
        stage = IslandStage(
            island_id=user_id,
            slot=slot,
            name=body.name,
            level_data=level_data,
        )
        db.add(stage)

    await db.commit()
    await db.refresh(stage)
    return _stage_to_response(stage)


@router.post("/islands/{user_id}/stages/{slot}/cleared", response_model=StageResponse)
async def mark_island_stage_cleared(
    user_id: UUID,
    slot: int = Path(ge=1, le=3),
    db: AsyncSession = Depends(get_session),
):
    stage = await _get_stage(db, user_id, slot)
    stage.cleared = True
    await db.commit()
    await db.refresh(stage)
    return _stage_to_response(stage)


@router.post("/islands/{user_id}/stages/{slot}/publish", response_model=StageResponse)
async def publish_island_stage(
    user_id: UUID,
    slot: int = Path(ge=1, le=3),
    db: AsyncSession = Depends(get_session),
):
    stage = await _get_stage(db, user_id, slot)
    if not stage.cleared:
        raise HTTPException(
            status_code=409, detail="Stage must be cleared before publishing"
        )
    stage.status = "published"
    await db.commit()
    await db.refresh(stage)
    return _stage_to_response(stage)


@router.post("/islands/{user_id}/stages/{slot}/unpublish", response_model=StageResponse)
async def unpublish_island_stage(
    user_id: UUID,
    slot: int = Path(ge=1, le=3),
    db: AsyncSession = Depends(get_session),
):
    stage = await _get_stage(db, user_id, slot)
    # cleared stays true: the level data is unchanged, so re-publishing
    # without a re-clear is legitimate.
    stage.status = "draft"
    await db.commit()
    await db.refresh(stage)
    return _stage_to_response(stage)


@router.delete("/islands/{user_id}/stages/{slot}")
async def delete_island_stage(
    user_id: UUID,
    slot: int = Path(ge=1, le=3),
    db: AsyncSession = Depends(get_session),
):
    stage = await _get_stage(db, user_id, slot)
    await db.delete(stage)
    await db.commit()
    return {"status": "deleted"}


# ── RPS Mini-Game Endpoints ──


@router.post(
    "/visits/{visit_id}/rps/rounds",
    response_model=rps_logic.RpsRoundResponse,
    status_code=201,
)
async def create_rps_round(
    visit_id: UUID,
    body: rps_logic.CreateRpsRoundRequest,
    db: AsyncSession = Depends(get_session),
):
    try:
        return await rps_logic.create_round(visit_id, body.initiator_id, db)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except ValueError as e:
        # not_found / insufficient_balance
        msg = str(e)
        status = 404 if "not_found" in msg else 422
        raise HTTPException(status_code=status, detail=msg) from e
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e


@router.post(
    "/visits/{visit_id}/rps/rounds/{round_id}/pick",
    response_model=rps_logic.RpsRoundResponse,
)
async def submit_rps_pick(
    visit_id: UUID,
    round_id: UUID,
    body: rps_logic.SubmitRpsPickRequest,
    db: AsyncSession = Depends(get_session),
):
    try:
        return await rps_logic.submit_pick(
            visit_id, round_id, body.sender_id, body.pick, db
        )
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except ValueError as e:
        msg = str(e)
        status = 404 if "not_found" in msg else 422
        raise HTTPException(status_code=status, detail=msg) from e
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e


@router.post(
    "/visits/{visit_id}/rps/rounds/{round_id}/decline",
    response_model=rps_logic.RpsRoundResponse,
)
async def decline_rps_round(
    visit_id: UUID,
    round_id: UUID,
    body: rps_logic.DeclineRpsRequest,
    db: AsyncSession = Depends(get_session),
):
    try:
        return await rps_logic.decline_round(visit_id, round_id, body.sender_id, db)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get(
    "/visits/{visit_id}/rps/rounds/{round_id}",
    response_model=rps_logic.RpsRoundResponse,
)
async def get_rps_round(visit_id: UUID, round_id: UUID):
    try:
        return await rps_logic.get_round(round_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
