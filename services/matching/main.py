"""Map + Matching API service."""
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from services.matching import geo, matcher
from services.matching.schemas import (
    AgentCreate,
    AgentMarkdownResponse,
    AgentResponse,
    AgentUpdate,
    IslandPosition,
    MarkdownPayload,
    MatchRequest,
    MatchResponse,
    NearbyIslandsResponse,
    PositionUpdate,
    ProfileUpdate,
    StatusUpdate,
    UserProfile,
)
from shared.agent_md import (
    agent_md_path,
    apply_frontmatter_to_agent,
    frontmatter_from_agent,
    parse_agent_md,
    render_agent_md,
    slugify,
)
from shared.db import get_sessionmaker
from shared.llm import (
    get_available_models,
    get_system_model,
    is_provider_configured,
    is_reasoning_model,
    parse_model,
)
from shared.models import Agent, MatchSession, User, UserAgent
from shared.redis_client import close_redis
from shared.telemetry import init_telemetry

# Project-root agents/ — MD files live at {AGENTS_DIR}/{user_uuid}/{slug}.md.
# Matches the worker's reference loader path (`services/worker/main.py:42`).
AGENTS_DIR = Path(__file__).resolve().parents[2] / "agents"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_telemetry("islume-matching")
    yield
    await close_redis()


app = FastAPI(title="Islume Map + Matching", lifespan=lifespan)


async def get_session() -> AsyncSession:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        yield session


@app.get("/health")
async def health():
    return {"status": "ok", "service": "matching"}


@app.get("/models")
async def list_models():
    # Reasoning models (gpt-5*/o1/o3/o4) are excluded from the conversation-model
    # picker: their hidden reasoning tokens share the output budget and can
    # return empty content on persona chat. See the worker's empty-reply guard.
    return {
        "models": [m for m in get_available_models() if not is_reasoning_model(m)],
        "system_model": get_system_model(),
    }


@app.post("/islands/{user_id}/position", status_code=204)
async def update_position(user_id: UUID, body: PositionUpdate):
    await geo.update_position(user_id, body.longitude, body.latitude)


@app.delete("/islands/{user_id}", status_code=204)
async def remove_island(user_id: UUID):
    await geo.remove_position(user_id)


@app.get("/islands/nearby", response_model=NearbyIslandsResponse)
async def nearby_islands(
    lat: float,
    lon: float,
    radius_m: float = 500.0,
    limit: int = 100,
    session: AsyncSession = Depends(get_session),
):
    results = await geo.search_nearby(lon, lat, radius_m, limit=limit)

    # Load user metadata and filter out invisible users
    user_map: dict[UUID, tuple[str, bool]] = {}
    if results:
        user_ids = [uid for uid, _, _, _ in results]
        user_stmt = select(User.id, User.display_name, User.is_active, User.is_visible).where(
            User.id.in_(user_ids),
        )
        user_result = await session.execute(user_stmt)
        for row in user_result.all():
            uid, name, active, visible = row
            if visible:
                user_map[uid] = (name, active)
        results = [r for r in results if r[0] in user_map]

    return NearbyIslandsResponse(
        center=PositionUpdate(longitude=lon, latitude=lat),
        radius_m=radius_m,
        islands=[
            IslandPosition(
                user_id=uid,
                longitude=lo,
                latitude=la,
                distance_m=dist,
                display_name=user_map[uid][0],
                is_active=user_map[uid][1],
            )
            for uid, lo, la, dist in results
        ],
    )


@app.post("/matches/find", response_model=MatchResponse)
async def find_match(
    body: MatchRequest, session: AsyncSession = Depends(get_session)
):
    # Load user's saved search settings as defaults
    user = await session.get(User, body.user_id)
    search_mode = body.search_mode or (user.search_mode if user else "exact_tags")
    min_sim = body.min_similarity if body.min_similarity is not None else (user.min_similarity if user else 0.3)

    candidates = await matcher.find_matches(
        session, body.user_id, body.radius_m, min_sim, search_mode
    )
    return MatchResponse(
        user_id=body.user_id,
        candidates=candidates,
        selected=candidates[0] if candidates else None,
    )


def _user_to_profile(user: User) -> UserProfile:
    return UserProfile(
        id=user.id,
        display_name=user.display_name,
        email=user.email,
        sex=user.sex,
        age=user.age,
        job=user.job,
        suburb=user.suburb,
        find_radius_m=user.find_radius_m,
        allow_1on1_chat=user.allow_1on1_chat,
        allow_group_chat=user.allow_group_chat,
        is_visible=user.is_visible,
        is_active=user.is_active,
        notification_enabled=user.notification_enabled,
        chatting_enabled=user.chatting_enabled,
        tier=user.tier,
        preferred_model=user.preferred_model,
        auto_approve_affinity=user.auto_approve_affinity,
        default_max_turns=user.default_max_turns,
        affinity_check_turns=user.affinity_check_turns,
        max_concurrent_chats=user.max_concurrent_chats,
        search_mode=user.search_mode,
        min_similarity=user.min_similarity,
    )


@app.get("/users/{user_id}/profile", response_model=UserProfile)
async def get_profile(user_id: UUID, session: AsyncSession = Depends(get_session)):
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return _user_to_profile(user)


@app.put("/users/{user_id}/profile", response_model=UserProfile)
async def update_profile(
    user_id: UUID, body: ProfileUpdate, session: AsyncSession = Depends(get_session)
):
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    update_data = body.model_dump(exclude_unset=True)

    # Validate preferred_model against available models and provider
    if "preferred_model" in update_data and update_data["preferred_model"] is not None:
        model_str = update_data["preferred_model"]
        allowed = get_available_models()
        if model_str not in allowed:
            raise HTTPException(
                status_code=422,
                detail=f"Model {model_str} is not available",
            )
        provider, _ = parse_model(model_str)
        if not is_provider_configured(provider):
            raise HTTPException(
                status_code=422,
                detail=f"Provider {provider} is not configured on this server",
            )

    for field, value in update_data.items():
        setattr(user, field, value)

    await session.commit()
    await session.refresh(user)
    return _user_to_profile(user)


@app.patch("/users/{user_id}/status", status_code=204)
async def update_status(
    user_id: UUID, body: StatusUpdate, session: AsyncSession = Depends(get_session)
):
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    if body.is_active is not None:
        user.is_active = body.is_active
    if body.is_visible is not None:
        user.is_visible = body.is_visible

    await session.commit()


# --- Agent CRUD ---


async def _allocate_unique_slug(
    session: AsyncSession, owner_id: UUID, base: str, exclude_agent_id: UUID | None = None
) -> str:
    """Pick a slug not yet used by `owner_id`'s other agents.

    Tries the base first, then `_2`, `_3`, ... up to a sensible cap. Slugs
    are scoped per-owner because agents/{owner}/{slug}.md is the on-disk
    namespace.
    """
    stmt = select(Agent.slug).where(Agent.created_by == owner_id)
    if exclude_agent_id is not None:
        stmt = stmt.where(Agent.id != exclude_agent_id)
    result = await session.execute(stmt)
    used = {row[0] for row in result.all() if row[0]}
    if base not in used:
        return base
    for i in range(2, 50):
        candidate = f"{base}_{i}"[:50]
        if candidate not in used:
            return candidate
    raise HTTPException(status_code=409, detail="too many slug collisions")


async def _export_agent_md(
    agent: Agent, owner: User
) -> str:
    """Render and write agents/{owner_id}/{slug}.md. Returns relative path.

    `agent.slug` must be set before calling. Failure to write raises
    HTTP 500 — callers should wrap and rollback the DB row.
    """
    fm = frontmatter_from_agent(agent, owner)
    body = agent.persona_prompt or ""
    md_text = render_agent_md(fm, body=body)
    try:
        path = agent_md_path(AGENTS_DIR, owner.id, agent.slug)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"invalid slug: {e}") from e
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.write_text(md_text, encoding="utf-8")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"failed to write md: {e}") from e
    return str(path.relative_to(AGENTS_DIR.parent))


def _delete_agent_md(owner_id: UUID, slug: str | None) -> None:
    """Best-effort deletion of agents/{owner_id}/{slug}.md.

    Missing file is fine. Refuses to follow paths outside AGENTS_DIR.
    """
    if not slug:
        return
    try:
        path = agent_md_path(AGENTS_DIR, owner_id, slug)
    except ValueError:
        return
    try:
        path.unlink(missing_ok=True)
    except OSError:
        # Non-fatal; orphan file is preferable to a 500 on delete.
        pass


async def _agent_to_response(
    session: AsyncSession, agent: Agent, user_id: UUID
) -> AgentResponse:
    ua_stmt = select(UserAgent.is_active).where(
        UserAgent.agent_id == agent.id,
        UserAgent.user_id == user_id,
    )
    ua_result = await session.execute(ua_stmt)
    is_active = ua_result.scalar_one_or_none() or False
    return AgentResponse(
        id=agent.id,
        name=agent.name,
        description=agent.description,
        persona_prompt=agent.persona_prompt,
        tone=agent.tone,
        tags=agent.tags or [],
        is_active=is_active,
        created_at=agent.created_at.isoformat(),
        goal=agent.goal,
        goal_category=agent.goal_category,
        interaction_mode=agent.interaction_mode,
        relationship_intent=agent.relationship_intent,
        compatible_intents=agent.compatible_intents,
        topics_of_interest=agent.topics_of_interest,
        schema_version=agent.schema_version,
        revision=agent.revision,
        demographics=agent.demographics,
        preferences=agent.preferences,
        translations=agent.translations,
        boundaries=agent.boundaries,
        attached_plugins=agent.attached_plugins,
    )


@app.get("/users/{user_id}/agents", response_model=list[AgentResponse])
async def list_agents(user_id: UUID, session: AsyncSession = Depends(get_session)):
    stmt = (
        select(Agent, UserAgent.is_active)
        .join(UserAgent, UserAgent.agent_id == Agent.id)
        .where(UserAgent.user_id == user_id)
        .order_by(Agent.created_at)
    )
    result = await session.execute(stmt)
    return [
        AgentResponse(
            id=agent.id,
            name=agent.name,
            description=agent.description,
            persona_prompt=agent.persona_prompt,
            tone=agent.tone,
            tags=agent.tags or [],
            is_active=is_active,
            created_at=agent.created_at.isoformat(),
            goal=agent.goal,
            goal_category=agent.goal_category,
            interaction_mode=agent.interaction_mode,
            relationship_intent=agent.relationship_intent,
            compatible_intents=agent.compatible_intents,
            topics_of_interest=agent.topics_of_interest,
            schema_version=agent.schema_version,
            revision=agent.revision,
            demographics=agent.demographics,
            preferences=agent.preferences,
            translations=agent.translations,
            boundaries=agent.boundaries,
            attached_plugins=agent.attached_plugins,
        )
        for agent, is_active in result.all()
    ]


@app.post("/users/{user_id}/agents", response_model=AgentResponse, status_code=201)
async def create_agent(
    user_id: UUID, body: AgentCreate, session: AsyncSession = Depends(get_session)
):
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    # slugify is ASCII-only; non-ASCII names (e.g. Korean) produce an empty
    # string and raise. In that case fall back to a random short slug so
    # users aren't blocked from naming agents in their own language.
    try:
        base_slug = slugify(body.name)
    except ValueError:
        base_slug = f"agent_{uuid4().hex[:8]}"
    slug = await _allocate_unique_slug(session, user_id, base_slug)

    agent = Agent(
        name=body.name,
        description=body.description,
        persona_prompt=body.persona_prompt,
        tone=body.tone,
        tags=body.tags,
        created_by=user_id,
        slug=slug,
        # v2 fields (None when not provided — keeps row v1-shaped)
        goal=body.goal,
        goal_category=body.goal_category,
        interaction_mode=body.interaction_mode,
        relationship_intent=body.relationship_intent,
        compatible_intents=body.compatible_intents,
        topics_of_interest=body.topics_of_interest,
        demographics=body.demographics,
        preferences=body.preferences,
        translations=body.translations,
        boundaries=body.boundaries,
        attached_plugins=(
            [e.model_dump() for e in body.attached_plugins]
            if body.attached_plugins
            else None
        ),
    )
    session.add(agent)
    await session.flush()

    ua = UserAgent(user_id=user_id, agent_id=agent.id, is_active=False)
    session.add(ua)

    # Render + write the .md mirror. On failure roll back the entire row.
    try:
        rel_path = await _export_agent_md(agent, user)
    except HTTPException:
        await session.rollback()
        raise
    agent.agent_md_path = rel_path

    await session.commit()
    await session.refresh(agent)

    return await _agent_to_response(session, agent, user_id)


@app.put("/agents/{agent_id}", response_model=AgentResponse)
async def update_agent(
    agent_id: UUID,
    user_id: UUID,
    body: AgentUpdate,
    session: AsyncSession = Depends(get_session),
):
    agent = await session.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Ownership check
    ua_stmt = select(UserAgent).where(
        UserAgent.agent_id == agent_id,
        UserAgent.user_id == user_id,
    )
    ua_result = await session.execute(ua_stmt)
    if ua_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=403, detail="Not your agent")

    updates = body.model_dump(exclude_unset=True)
    old_slug = agent.slug
    for field, value in updates.items():
        setattr(agent, field, value)
    if updates:
        agent.revision = (agent.revision or 1) + 1

    # If the display name changed (and no slug yet), allocate one.
    owner = await session.get(User, agent.created_by)
    if owner is None:
        raise HTTPException(status_code=404, detail="Agent owner missing")
    if "name" in updates and not agent.slug:
        try:
            base = slugify(agent.name)
        except ValueError:
            base = f"agent_{uuid4().hex[:8]}"
        agent.slug = await _allocate_unique_slug(
            session, owner.id, base, exclude_agent_id=agent.id
        )

    # Re-export the .md mirror with the latest values.
    try:
        rel_path = await _export_agent_md(agent, owner)
    except HTTPException:
        await session.rollback()
        raise
    agent.agent_md_path = rel_path
    # Clean up the previous file if the slug changed.
    if old_slug and old_slug != agent.slug:
        _delete_agent_md(owner.id, old_slug)

    await session.commit()
    await session.refresh(agent)
    return await _agent_to_response(session, agent, user_id)


@app.delete("/agents/{agent_id}", status_code=204)
async def delete_agent(
    agent_id: UUID,
    user_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    agent = await session.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Ownership check
    ua_stmt = select(UserAgent).where(
        UserAgent.agent_id == agent_id,
        UserAgent.user_id == user_id,
    )
    ua_result = await session.execute(ua_stmt)
    if ua_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=403, detail="Not your agent")

    # Check for ANY sessions (active or completed) — FK constraints prevent deletion
    session_stmt = select(MatchSession.id).where(
        (MatchSession.agent_a_id == agent_id) | (MatchSession.agent_b_id == agent_id),
    ).limit(1)
    session_result = await session.execute(session_stmt)
    if session_result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Agent has session history")

    # Delete user_agent links first, then the agent
    owner_id = agent.created_by
    slug = agent.slug
    await session.execute(delete(UserAgent).where(UserAgent.agent_id == agent_id))
    await session.delete(agent)
    await session.commit()
    if owner_id:
        _delete_agent_md(owner_id, slug)


@app.get("/agents/{agent_id}/markdown", response_model=AgentMarkdownResponse)
async def get_agent_markdown(
    agent_id: UUID,
    user_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """Return the raw .md file for an agent.

    If the file is missing on disk (e.g. agent was created before this
    feature shipped, or the directory was wiped), it is lazily re-rendered
    from the DB row so the user always sees something editable.
    """
    agent = await session.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Ownership check — same model as other agent routes.
    ua_stmt = select(UserAgent).where(
        UserAgent.agent_id == agent_id,
        UserAgent.user_id == user_id,
    )
    ua_result = await session.execute(ua_stmt)
    if ua_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=403, detail="Not your agent")

    owner = await session.get(User, agent.created_by)
    if owner is None:
        raise HTTPException(status_code=404, detail="Agent owner missing")

    # Make sure the agent has a slug — older rows might be missing one.
    if not agent.slug:
        try:
            base = slugify(agent.name)
        except ValueError:
            base = f"agent_{uuid4().hex[:8]}"
        agent.slug = await _allocate_unique_slug(
            session, owner.id, base, exclude_agent_id=agent.id
        )
        await session.commit()
        await session.refresh(agent)

    try:
        path = agent_md_path(AGENTS_DIR, owner.id, agent.slug)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    if path.is_file():
        try:
            markdown = path.read_text(encoding="utf-8")
        except OSError as e:
            raise HTTPException(status_code=500, detail=str(e)) from e
    else:
        # Lazy re-export from the DB row.
        rel_path = await _export_agent_md(agent, owner)
        agent.agent_md_path = rel_path
        await session.commit()
        markdown = path.read_text(encoding="utf-8")

    return AgentMarkdownResponse(
        agent_id=agent.id, markdown=markdown, revision=agent.revision or 1
    )


@app.put("/agents/{agent_id}/markdown", response_model=AgentMarkdownResponse)
async def put_agent_markdown(
    agent_id: UUID,
    user_id: UUID,
    body: MarkdownPayload,
    session: AsyncSession = Depends(get_session),
):
    """Replace the raw .md file for an agent and sync the DB row.

    The submitted markdown is parsed via `parse_agent_md`. On parse error
    the file and DB row are left untouched and 422 is returned with the
    parser's message. On success: every v2 column is overwritten from the
    new frontmatter, `persona_prompt` is set to the new body, the file is
    rewritten in canonical (re-rendered) form, and `revision` is bumped.
    """
    agent = await session.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    ua_stmt = select(UserAgent).where(
        UserAgent.agent_id == agent_id,
        UserAgent.user_id == user_id,
    )
    ua_result = await session.execute(ua_stmt)
    if ua_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=403, detail="Not your agent")

    owner = await session.get(User, agent.created_by)
    if owner is None:
        raise HTTPException(status_code=404, detail="Agent owner missing")

    try:
        fm, parsed_body = parse_agent_md(body.markdown)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    # Reject impersonation: frontmatter agent_id / owner must line up with
    # the URL agent and its owner. Slug we trust if it's well-formed; the
    # path helper already enforces traversal safety.
    if fm.agent_id != agent.id:
        raise HTTPException(
            status_code=422,
            detail=f"frontmatter agent_id {fm.agent_id} does not match URL {agent.id}",
        )
    if fm.owner_user_id != owner.id:
        raise HTTPException(
            status_code=422,
            detail="frontmatter owner_user_id does not match agent owner",
        )

    old_slug = agent.slug
    if fm.slug != old_slug:
        # Make sure the new slug is not taken by another of this user's agents.
        new_slug = await _allocate_unique_slug(
            session, owner.id, fm.slug, exclude_agent_id=agent.id
        )
        if new_slug != fm.slug:
            raise HTTPException(
                status_code=409,
                detail=f"slug {fm.slug!r} already used by another of your agents",
            )

    apply_frontmatter_to_agent(agent, fm)
    agent.persona_prompt = parsed_body
    agent.revision = (agent.revision or 1) + 1

    # Write the canonical render so round-trip is stable on the disk too.
    try:
        rel_path = await _export_agent_md(agent, owner)
    except HTTPException:
        await session.rollback()
        raise
    agent.agent_md_path = rel_path

    if old_slug and old_slug != agent.slug:
        _delete_agent_md(owner.id, old_slug)

    await session.commit()
    await session.refresh(agent)

    canonical_path = agent_md_path(AGENTS_DIR, owner.id, agent.slug)
    canonical_md = canonical_path.read_text(encoding="utf-8")
    return AgentMarkdownResponse(
        agent_id=agent.id, markdown=canonical_md, revision=agent.revision
    )


@app.patch("/agents/{agent_id}/activate", response_model=AgentResponse)
async def toggle_agent_active(
    agent_id: UUID,
    user_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    ua_stmt = select(UserAgent).where(
        UserAgent.agent_id == agent_id,
        UserAgent.user_id == user_id,
    )
    ua_result = await session.execute(ua_stmt)
    ua = ua_result.scalar_one_or_none()
    if ua is None:
        raise HTTPException(status_code=404, detail="Agent not linked to user")

    ua.is_active = not ua.is_active
    if ua.is_active:
        ua.activated_at = func.now()
    await session.commit()

    agent = await session.get(Agent, agent_id)
    return await _agent_to_response(session, agent, user_id)
