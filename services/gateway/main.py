"""WebSocket Gateway: bridges client connections to session event streams."""
import json as json_module
from contextlib import asynccontextmanager
from datetime import datetime
from uuid import UUID

from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from services.visit.user_events import publish_user_event
from shared.db import get_sessionmaker
from shared.messages import ChatEvent, WalletEvent, session_stream, wallet_stream
from shared.models import (
    ChatMember,
    ChatMessage,
    ChatRoom,
    DirectMessage,
    User,
    VisitSession,
)
from shared.redis_client import close_redis, get_redis


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await close_redis()


app = FastAPI(title="Islume Gateway", lifespan=lifespan)


async def get_session() -> AsyncSession:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        yield session


@app.get("/health")
async def health():
    return {"status": "ok", "service": "gateway"}


@app.websocket("/ws/sessions/{session_id}")
async def session_socket(websocket: WebSocket, session_id: UUID):
    """Stream all events for a session, from the beginning, then live.

    This uses Redis Streams (not Pub/Sub) so:
    - No race condition between subscribe and replay
    - Late connections see the full conversation history
    - No message loss is structurally possible
    """
    await websocket.accept()
    r = get_redis()
    stream_key = session_stream(session_id)

    await websocket.send_json({
        "event_type": "connected",
        "session_id": str(session_id),
        "stream": stream_key,
    })
    print(f"\n[gateway] client connected to {stream_key}")

    # Start from the beginning of the stream
    last_id = "0"
    session_ended = False

    try:
        while not session_ended:
            # XREAD with BLOCK waits for new messages after last_id.
            # First call uses "0" → returns all existing messages immediately.
            # Subsequent calls use the last seen ID → blocks until new arrivals.
            response = await r.xread(
                streams={stream_key: last_id},
                block=30000,  # 30s timeout, then loop and try again
                count=100,
            )
            if not response:
                continue

            for _stream_name, entries in response:
                for entry_id, data in entries:
                    last_id = entry_id
                    try:
                        event = ChatEvent.from_redis(data)
                    except Exception as e:
                        print(f"  [skip] failed to parse entry {entry_id}: {e}")
                        continue

                    payload = event.to_client_dict()
                    await websocket.send_json(payload)
                    print(f"  [forward] {event.event_type} turn={event.turn_number}")

                    if event.event_type == "session_ended":
                        session_ended = True
                        break

        # History fully replayed (including session_ended). Do NOT return here —
        # returning closes the socket immediately, which races the frames we just
        # sent. When a client opens an already-finished session, the whole history
        # plus session_ended is flushed in a single burst and a server-side close
        # can tear the connection down before the client drains its receive buffer
        # (observed: client gets 0 turns and a 1006 abnormal close, so the
        # conversation renders empty — while a live viewer who streamed the turns
        # incrementally is unaffected). Hold the socket open and let the CLIENT
        # close it after it processes session_ended (frontend lib/ws.ts does
        # exactly that). This mirrors the chat/wallet/visit sockets, none of which
        # self-close.
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        print("[gateway] client disconnected")


@app.websocket("/ws/wallet/{user_id}")
async def wallet_socket(websocket: WebSocket, user_id: UUID):
    """Stream wallet events (transfers, balance updates) for a user."""
    await websocket.accept()
    r = get_redis()
    stream_key = wallet_stream(user_id)

    await websocket.send_json({
        "event_type": "connected",
        "user_id": str(user_id),
        "stream": stream_key,
    })

    last_id = "0"
    try:
        while True:
            response = await r.xread(
                streams={stream_key: last_id},
                block=30000,
                count=100,
            )
            if not response:
                continue
            for _stream_name, entries in response:
                for entry_id, data in entries:
                    last_id = entry_id
                    try:
                        event = WalletEvent.from_redis(data)
                    except Exception as e:
                        print(f"  [skip] wallet event parse error {entry_id}: {e}")
                        continue
                    await websocket.send_json(event.to_client_dict())
    except WebSocketDisconnect:
        pass


# --- Direct Chat API ---


class CreateRoomRequest(BaseModel):
    room_type: str = "direct"
    member_ids: list[UUID]
    name: str | None = None


class RoomResponse(BaseModel):
    id: UUID
    room_type: str
    name: str | None
    created_by: UUID
    created_at: str
    members: list[UUID]
    member_names: dict[UUID, str] = {}


async def _find_direct_room(
    session: AsyncSession, a: UUID, b: UUID
) -> ChatRoom | None:
    """Return the existing direct room shared by exactly members {a, b}, if any.

    Direct rooms are unique per unordered member pair; this keeps "open a chat
    with X" idempotent instead of spawning a new room on every click.
    """
    stmt = (
        select(ChatRoom)
        .join(ChatMember, ChatMember.room_id == ChatRoom.id)
        .where(ChatRoom.room_type == "direct", ChatMember.user_id == a)
    )
    result = await session.execute(stmt)
    for room in result.scalars():
        members_stmt = select(ChatMember.user_id).where(
            ChatMember.room_id == room.id
        )
        members = {row[0] for row in (await session.execute(members_stmt)).all()}
        if members == {a, b}:
            return room
    return None


class MessageResponse(BaseModel):
    id: UUID
    room_id: UUID
    sender_id: UUID
    sender_name: str | None = None
    content: str
    created_at: str


@app.post("/chat/rooms", response_model=RoomResponse, status_code=201)
async def create_chat_room(
    body: CreateRoomRequest, session: AsyncSession = Depends(get_session)
):
    if len(body.member_ids) < 2:
        raise HTTPException(status_code=422, detail="Need at least 2 members")

    creator_id = body.member_ids[0]

    # Validate members exist and collect their names. Direct chats use a
    # deferred model (message always stored; recipient's client decides how to
    # surface it via its own chatting_enabled), so room creation never blocks on
    # the recipient's preferences — only group chat keeps an opt-out gate.
    member_names: dict[UUID, str] = {}
    for uid in body.member_ids:
        user = await session.get(User, uid)
        if user is None:
            raise HTTPException(status_code=404, detail=f"User {uid} not found")
        if body.room_type == "group" and not user.allow_group_chat:
            raise HTTPException(
                status_code=403, detail=f"User {uid} has group chat disabled"
            )
        member_names[uid] = user.display_name

    # Find-or-create: reuse the existing 1:1 room for this pair if one exists.
    if body.room_type == "direct" and len(body.member_ids) == 2:
        existing = await _find_direct_room(
            session, body.member_ids[0], body.member_ids[1]
        )
        if existing is not None:
            return RoomResponse(
                id=existing.id,
                room_type=existing.room_type,
                name=existing.name,
                created_by=existing.created_by,
                created_at=existing.created_at.isoformat(),
                members=body.member_ids,
                member_names=member_names,
            )

    room = ChatRoom(
        room_type=body.room_type,
        name=body.name,
        created_by=creator_id,
    )
    session.add(room)
    await session.flush()

    for uid in body.member_ids:
        session.add(ChatMember(room_id=room.id, user_id=uid))

    await session.commit()
    await session.refresh(room)

    return RoomResponse(
        id=room.id,
        room_type=room.room_type,
        name=room.name,
        created_by=room.created_by,
        created_at=room.created_at.isoformat(),
        members=body.member_ids,
        member_names=member_names,
    )


@app.get("/chat/rooms", response_model=list[RoomResponse])
async def list_chat_rooms(
    user_id: UUID = Query(...), session: AsyncSession = Depends(get_session)
):
    stmt = (
        select(ChatRoom)
        .join(ChatMember, ChatMember.room_id == ChatRoom.id)
        .where(ChatMember.user_id == user_id)
        .order_by(ChatRoom.created_at.desc())
    )
    result = await session.execute(stmt)
    rooms = list(result.scalars())

    responses = []
    for room in rooms:
        members_stmt = (
            select(ChatMember.user_id, User.display_name)
            .join(User, User.id == ChatMember.user_id)
            .where(ChatMember.room_id == room.id)
        )
        members_result = await session.execute(members_stmt)
        member_rows = members_result.all()
        member_ids = [row[0] for row in member_rows]
        member_names = {row[0]: row[1] for row in member_rows}
        responses.append(RoomResponse(
            id=room.id,
            room_type=room.room_type,
            name=room.name,
            created_by=room.created_by,
            created_at=room.created_at.isoformat(),
            members=member_ids,
            member_names=member_names,
        ))
    return responses


@app.get("/chat/rooms/{room_id}/messages", response_model=list[MessageResponse])
async def list_chat_messages(
    room_id: UUID,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
):
    stmt = (
        select(ChatMessage, User.display_name)
        .join(User, User.id == ChatMessage.sender_id)
        .where(ChatMessage.room_id == room_id)
        .order_by(ChatMessage.created_at)
        .offset(offset)
        .limit(limit)
    )
    result = await session.execute(stmt)
    return [
        MessageResponse(
            id=msg.id,
            room_id=msg.room_id,
            sender_id=msg.sender_id,
            sender_name=name,
            content=msg.content,
            created_at=msg.created_at.isoformat(),
        )
        for msg, name in result.all()
    ]


CHAT_STREAM_PREFIX = "stream:chat:"


@app.websocket("/ws/chat/{room_id}")
async def chat_socket(websocket: WebSocket, room_id: UUID):
    """Real-time chat via WebSocket + Redis Streams."""
    await websocket.accept()
    r = get_redis()
    stream_key = f"{CHAT_STREAM_PREFIX}{room_id}"

    await websocket.send_json({
        "event_type": "connected",
        "room_id": str(room_id),
    })

    # Start reading from beginning for history
    last_id = "0"

    try:
        import asyncio

        async def reader():
            """Read messages from Redis stream and forward to client."""
            nonlocal last_id
            while True:
                response = await r.xread(
                    streams={stream_key: last_id},
                    block=30000,
                    count=50,
                )
                if not response:
                    continue
                for _stream_name, entries in response:
                    for entry_id, data in entries:
                        last_id = entry_id
                        await websocket.send_json({
                            "event_type": "message",
                            "id": data.get("id", ""),
                            "room_id": str(room_id),
                            "sender_id": data.get("sender_id", ""),
                            "sender_name": data.get("sender_name", ""),
                            "content": data.get("content", ""),
                            "created_at": data.get("created_at", ""),
                        })

        async def writer():
            """Receive messages from client, save to DB, publish to stream."""
            sessionmaker = get_sessionmaker()
            while True:
                raw = await websocket.receive_text()
                data = json_module.loads(raw)
                sender_id = UUID(data["sender_id"])
                content = data["content"]

                async with sessionmaker() as db:
                    # Look up sender name
                    user = await db.get(User, sender_id)
                    sender_name = user.display_name if user else "Unknown"

                    msg = ChatMessage(
                        room_id=room_id,
                        sender_id=sender_id,
                        content=content,
                    )
                    db.add(msg)
                    await db.commit()
                    await db.refresh(msg)

                    # Publish to stream (DB commit before stream publish)
                    await r.xadd(stream_key, {
                        "id": str(msg.id),
                        "sender_id": str(sender_id),
                        "sender_name": sender_name,
                        "content": content,
                        "created_at": msg.created_at.isoformat(),
                    })

                    # Notify the other room members on their personal channel so
                    # they get a toast/unread badge even when this room isn't
                    # open. The recipient's client decides whether to surface a
                    # live chat or just a notification, based on its own
                    # notification_enabled / chatting_enabled prefs.
                    others_stmt = select(ChatMember.user_id).where(
                        ChatMember.room_id == room_id,
                        ChatMember.user_id != sender_id,
                    )
                    others = (await db.execute(others_stmt)).scalars().all()
                    for other_id in others:
                        await publish_user_event(
                            other_id,
                            "chat:received",
                            {
                                "room_id": str(room_id),
                                "sender_id": str(sender_id),
                                "sender_name": sender_name,
                                "preview": content[:80],
                            },
                        )

        # Run reader and writer concurrently
        reader_task = asyncio.create_task(reader())
        writer_task = asyncio.create_task(writer())
        _, pending = await asyncio.wait(
            [reader_task, writer_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()

    except WebSocketDisconnect:
        pass


# --- Visit WebSocket ---


def visit_stream_key(visit_id: UUID) -> str:
    return f"stream:visit:{visit_id}"


def dm_stream_key(visit_id: UUID) -> str:
    return f"stream:dm:{visit_id}"


def user_stream_key(user_id: UUID) -> str:
    return f"stream:user:{user_id}"


@app.websocket("/ws/user/{user_id}")
async def user_socket(websocket: WebSocket, user_id: UUID):
    """Per-user push notification channel.

    Forwards entries from `stream:user:{user_id}` to the connected client.
    Receive-only (no client→server messages). Used for visit:incoming /
    visit:arrived / visit:ended / dm:received / rps:invite / rps:reveal /
    rps:cancelled events.
    """
    await websocket.accept()
    r = get_redis()
    stream_key = user_stream_key(user_id)

    await websocket.send_json({
        "type": "connected",
        "data": {"user_id": str(user_id), "stream": stream_key},
    })

    last_id = "$"  # only deliver events that arrive after connect
    try:
        while True:
            resp = await r.xread(streams={stream_key: last_id}, block=30000, count=50)
            if not resp:
                continue
            for _s, entries in resp:
                for entry_id, data in entries:
                    last_id = entry_id
                    await websocket.send_json({
                        "type": data.get("type", "user:unknown"),
                        "data": {k: v for k, v in data.items() if k != "type"},
                    })
    except WebSocketDisconnect:
        pass


@app.websocket("/ws/visit/{visit_id}")
async def visit_socket(websocket: WebSocket, visit_id: UUID):
    """Multiplexed WebSocket for visit session events + DM chat.

    Client → server events (JSON):
      - {"type": "visit:move",   "data": {"x", "y"}}
      - {"type": "visit:arrive", "data": {}}
      - {"type": "dm:message",   "data": {"sender_id", "content"}}
      - {"type": "dm:typing",    "data": {"sender_id", "is_typing"}}

    Server → client events:
      - visit:enter | visit:move | visit:arrive | visit:leave | dm:message | dm:typing
    """
    await websocket.accept()
    r = get_redis()
    visit_key = visit_stream_key(visit_id)
    dm_key = dm_stream_key(visit_id)

    # Load visit + host info for enter event
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        visit = await db.get(VisitSession, visit_id)
        if not visit:
            await websocket.send_json({"type": "error", "data": {"detail": "Visit not found"}})
            await websocket.close()
            return
        visitor = await db.get(User, visit.visitor_id)
        host = await db.get(User, visit.host_id)
        visitor_name = visitor.display_name if visitor else ""
        host_name = host.display_name if host else ""

    await websocket.send_json({
        "type": "connected",
        "data": {
            "visit_id": str(visit_id),
            "visitor_id": str(visit.visitor_id),
            "visitor_name": visitor_name,
            "host_id": str(visit.host_id),
            "host_name": host_name,
            "status": visit.status,
        },
    })

    async def visit_reader():
        last_id = "0"
        while True:
            resp = await r.xread(streams={visit_key: last_id}, block=30000, count=50)
            if not resp:
                continue
            for _s, entries in resp:
                for entry_id, data in entries:
                    last_id = entry_id
                    await websocket.send_json({
                        "type": data.get("type", "visit:unknown"),
                        "data": {k: v for k, v in data.items() if k != "type"},
                    })

    async def dm_reader():
        last_id = "0"
        while True:
            resp = await r.xread(streams={dm_key: last_id}, block=30000, count=50)
            if not resp:
                continue
            for _s, entries in resp:
                for entry_id, data in entries:
                    last_id = entry_id
                    await websocket.send_json({
                        "type": "dm:message",
                        "data": {
                            "id": data.get("id", ""),
                            "visit_session_id": data.get("visit_session_id", str(visit_id)),
                            "sender_id": data.get("sender_id", ""),
                            "sender_name": data.get("sender_name", ""),
                            "content": data.get("content", ""),
                            "created_at": data.get("created_at", ""),
                        },
                    })

    async def writer():
        """Receive client events, persist where needed, publish to streams."""
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json_module.loads(raw)
            except Exception:  # nosec B112  # drop malformed client frames, keep reading
                continue
            t = msg.get("type")
            data = msg.get("data") or {}

            if t == "visit:move":
                x = int(data.get("x", 0))
                y = int(data.get("y", 0))
                async with sessionmaker() as db:
                    v = await db.get(VisitSession, visit_id)
                    if v and v.status != "ended":
                        v.visitor_x = x
                        v.visitor_y = y
                        await db.commit()
                move_data: dict[str, str] = {"type": "visit:move", "x": str(x), "y": str(y)}
                # Forward optional 3D fields
                for field in ("z", "rot_y", "anim"):
                    if field in data:
                        move_data[field] = str(data[field])
                await r.xadd(visit_key, move_data)

            elif t == "visit:arrive":
                async with sessionmaker() as db:
                    v = await db.get(VisitSession, visit_id)
                    if v and v.status == "active":
                        v.status = "arrived"
                        v.arrived_at = datetime.utcnow()
                        await db.commit()
                        visitor_user = await db.get(User, v.visitor_id)
                        visitor_name = visitor_user.display_name if visitor_user else ""
                        await r.xadd(visit_key, {
                            "type": "visit:arrive",
                            "visit_id": str(visit_id),
                            "arrived_at": v.arrived_at.isoformat(),
                        })
                        # Notify the host's personal user-channel so World view
                        # can mount the host-side chat panel.
                        await publish_user_event(
                            v.host_id,
                            "visit:arrived",
                            {
                                "visit_id": str(visit_id),
                                "visitor_id": str(v.visitor_id),
                                "visitor_name": visitor_name,
                            },
                        )

            elif t == "visit:leave":
                async with sessionmaker() as db:
                    v = await db.get(VisitSession, visit_id)
                    if v and v.status != "ended":
                        v.status = "ended"
                        v.ended_at = datetime.utcnow()
                        await db.commit()
                await r.xadd(visit_key, {
                    "type": "visit:leave",
                    "visit_id": str(visit_id),
                })
                await r.delete(f"visit:active:{visit.host_id}")
                # Notify both sides' user-channels so the host chat panel
                # tears down and the visitor toast fires.
                for uid in (visit.visitor_id, visit.host_id):
                    await publish_user_event(
                        uid, "visit:ended", {"visit_id": str(visit_id)}
                    )

            elif t == "dm:message":
                sender_id_raw = data.get("sender_id")
                content = (data.get("content") or "").strip()
                if not sender_id_raw or not content:
                    continue
                try:
                    sender_uuid = UUID(sender_id_raw)
                except ValueError:
                    continue
                async with sessionmaker() as db:
                    v = await db.get(VisitSession, visit_id)
                    if not v or v.status != "arrived":
                        continue
                    if sender_uuid not in (v.visitor_id, v.host_id):
                        continue
                    sender = await db.get(User, sender_uuid)
                    if not sender:
                        continue
                    dm = DirectMessage(
                        visit_session_id=visit_id,
                        sender_id=sender_uuid,
                        content=content,
                    )
                    db.add(dm)
                    await db.commit()
                    await db.refresh(dm)
                    await r.xadd(dm_key, {
                        "id": str(dm.id),
                        "visit_session_id": str(visit_id),
                        "sender_id": str(sender_uuid),
                        "sender_name": sender.display_name,
                        "content": content,
                        "created_at": dm.created_at.isoformat(),
                    })

            elif t == "island:block_update":
                changes = data.get("changes", [])
                if isinstance(changes, list) and len(changes) <= 100:
                    await r.xadd(visit_key, {
                        "type": "island:block_update",
                        "changes": json_module.dumps(changes),
                    })

            elif t == "dm:typing":
                sender_id_raw = data.get("sender_id", "")
                is_typing = "1" if data.get("is_typing") else "0"
                await r.xadd(visit_key, {
                    "type": "dm:typing",
                    "sender_id": sender_id_raw,
                    "is_typing": is_typing,
                })

    try:
        import asyncio
        v_task = asyncio.create_task(visit_reader())
        d_task = asyncio.create_task(dm_reader())
        w_task = asyncio.create_task(writer())
        _, pending = await asyncio.wait(
            [v_task, d_task, w_task], return_when=asyncio.FIRST_COMPLETED
        )
        for p in pending:
            p.cancel()
    except WebSocketDisconnect:
        pass


@app.get("/", response_class=HTMLResponse)
async def index():
    return """<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Islume — Session Viewer</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 700px; margin: 2rem auto; padding: 0 1rem; background: #fafaf8; color: #1a1a18; }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  .meta { color: #888; font-size: 0.85rem; margin-bottom: 1.5rem; }
  input[type=text] { width: 100%; padding: 0.6rem 0.8rem; font-family: monospace; border: 1px solid #ccc; border-radius: 6px; margin-bottom: 0.5rem; }
  button { padding: 0.6rem 1.2rem; background: #1a1a18; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; }
  button:hover { background: #444; }
  #status { padding: 0.5rem 0.8rem; border-radius: 6px; font-size: 0.85rem; margin: 1rem 0; background: #eee; }
  #status.connected { background: #d4f4dd; color: #1a5c2d; }
  #status.ended { background: #f4e4d4; color: #5c3a1a; }
  .turn { margin: 0.75rem 0; padding: 0.75rem 1rem; border-radius: 8px; line-height: 1.5; }
  .turn.a { background: #e1f5ee; border-left: 3px solid #0f6e56; }
  .turn.b { background: #f5e1ee; border-left: 3px solid #993556; }
  .turn .speaker { font-weight: 600; font-size: 0.85rem; margin-bottom: 0.25rem; }
  .turn.a .speaker { color: #0f6e56; }
  .turn.b .speaker { color: #993556; }
</style>
</head>
<body>
<h1>Islume — Session Viewer</h1>
<div class="meta">Watch a conversation unfold in real time</div>
<input id="sessionId" type="text" placeholder="Enter session UUID...">
<button onclick="connect()">Connect</button>
<div id="status">Not connected</div>
<div id="messages"></div>
<script>
let ws = null;
let firstSpeaker = null;

function connect() {
  if (ws) ws.close();
  document.getElementById('messages').innerHTML = '';
  firstSpeaker = null;
  const sessionId = document.getElementById('sessionId').value.trim();
  if (!sessionId) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws/sessions/${sessionId}`);
  ws.onopen = () => setStatus('Connecting...', '');
  ws.onmessage = (e) => {
    const event = JSON.parse(e.data);
    if (event.event_type === 'connected') {
      setStatus(`Connected to ${event.stream}`, 'connected');
    } else if (event.event_type === 'turn') {
      addTurn(event);
    } else if (event.event_type === 'session_ended') {
      setStatus('Session ended', 'ended');
      ws.close();
    }
  };
  ws.onerror = () => setStatus('Error', '');
  ws.onclose = () => {
    if (!document.getElementById('status').classList.contains('ended')) {
      setStatus('Disconnected', '');
    }
  };
}

function addTurn(event) {
  if (firstSpeaker === null) firstSpeaker = event.speaker_agent_id;
  const side = event.speaker_agent_id === firstSpeaker ? 'a' : 'b';
  const div = document.createElement('div');
  div.className = `turn ${side}`;
  div.innerHTML = `<div class="speaker">${event.speaker_name} · turn ${event.turn_number}</div>${event.content}`;
  document.getElementById('messages').appendChild(div);
  window.scrollTo(0, document.body.scrollHeight);
}

function setStatus(text, cls) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.className = cls;
}
</script>
</body>
</html>
"""
