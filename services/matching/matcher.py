"""Core matching logic combining proximity and similarity."""
import asyncio
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from services.matching.geo import get_position, search_nearby
from services.matching.schemas import MatchCandidate
from services.matching.similarity import jaccard_similarity, llm_similarity
from shared.config import get_settings
from shared.models import Agent, User, UserAgent


async def find_matches(
    session: AsyncSession,
    user_id: UUID,
    radius_m: float,
    min_similarity: float,
    search_mode: str = "exact_tags",
) -> list[MatchCandidate]:
    """Find matching candidates for a user.

    search_mode:
      - "show_all": return all active agents in radius, no similarity filter
      - "exact_tags": Jaccard similarity on tag sets
      - "semantic": LLM-judged similarity (Haiku)
    """
    # 0. Check if requesting user is active
    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        return []

    # 1. Get this user's position
    pos = await get_position(user_id)
    if pos is None:
        return []
    lon, lat = pos

    # 2. Get ALL of this user's active agents (not needed for show_all)
    my_agents = await _get_active_agents(session, user_id)
    if not my_agents and search_mode != "show_all":
        return []

    # 3. Find nearby users via Redis GEO
    nearby = await search_nearby(lon, lat, radius_m, exclude=user_id)
    if not nearby:
        return []

    # 4. Filter out inactive users and load display names
    nearby_user_ids = [n[0] for n in nearby]
    user_names: dict[UUID, str] = {}
    if nearby_user_ids:
        active_stmt = select(User.id, User.display_name).where(
            User.id.in_(nearby_user_ids),
            User.is_active.is_(True),
        )
        active_result = await session.execute(active_stmt)
        for row in active_result.all():
            user_names[row[0]] = row[1]
        active_ids = set(user_names.keys())
        nearby_user_ids = [uid for uid in nearby_user_ids if uid in active_ids]
        if not nearby_user_ids:
            return []

    # 5. Load all active agents for nearby users
    candidate_agents = await _get_active_agents_bulk(session, nearby_user_ids)
    distances = {n[0]: n[3] for n in nearby}

    # 6. Branch by search mode
    if search_mode == "show_all":
        candidates = _match_show_all(candidate_agents, distances, my_agents, user_names)
    elif search_mode == "semantic":
        candidates = await _match_semantic(
            my_agents, candidate_agents, distances, min_similarity, user_names,
        )
    else:  # exact_tags (default)
        candidates = _match_exact_tags(
            my_agents, candidate_agents, distances, min_similarity, user_names,
        )

    # 7. Limit to max_concurrent_chats
    return candidates[: user.max_concurrent_chats]


def _match_show_all(
    candidate_agents: dict[UUID, list[Agent]],
    distances: dict[UUID, float],
    my_agents: list[Agent],
    user_names: dict[UUID, str],
) -> list[MatchCandidate]:
    """Return all active agents in radius, sorted by distance."""
    candidates: list[MatchCandidate] = []
    # Use first active agent as my_agent_id (or a zero UUID if none)
    my_agent_id = my_agents[0].id if my_agents else UUID(int=0)
    for cand_user_id, their_agents in candidate_agents.items():
        for their_agent in their_agents:
            candidates.append(
                MatchCandidate(
                    user_id=cand_user_id,
                    agent_id=their_agent.id,
                    my_agent_id=my_agent_id,
                    similarity_score=0.0,
                    distance_m=distances[cand_user_id],
                    display_name=user_names.get(cand_user_id, ""),
                    agent_name=their_agent.name,
                )
            )
    candidates.sort(key=lambda c: c.distance_m)
    return candidates


def _match_exact_tags(
    my_agents: list[Agent],
    candidate_agents: dict[UUID, list[Agent]],
    distances: dict[UUID, float],
    min_similarity: float,
    user_names: dict[UUID, str],
) -> list[MatchCandidate]:
    """Jaccard tag similarity matching."""
    candidates: list[MatchCandidate] = []
    for my_agent in my_agents:
        my_tags = my_agent.tags or []
        for cand_user_id, their_agents in candidate_agents.items():
            for their_agent in their_agents:
                score = jaccard_similarity(my_tags, their_agent.tags or [])
                if score < min_similarity:
                    continue
                candidates.append(
                    MatchCandidate(
                        user_id=cand_user_id,
                        agent_id=their_agent.id,
                        my_agent_id=my_agent.id,
                        similarity_score=score,
                        distance_m=distances[cand_user_id],
                        display_name=user_names.get(cand_user_id, ""),
                        agent_name=their_agent.name,
                    )
                )
    candidates.sort(key=lambda c: c.similarity_score, reverse=True)
    return candidates


async def _match_semantic(
    my_agents: list[Agent],
    candidate_agents: dict[UUID, list[Agent]],
    distances: dict[UUID, float],
    min_similarity: float,
    user_names: dict[UUID, str],
) -> list[MatchCandidate]:
    """Jaccard pre-filter → top-N LLM evaluation.

    Agents are already sorted by activated_at DESC, so my_agents[0] is the
    user's current primary agent and each candidate's [0] is theirs.

    Strategy:
      1. Compute Jaccard for ALL (my_agent, their_agent) pairs (cost: 0)
      2. Take top MAX_SEMANTIC_PAIRS by Jaccard score
      3. Run LLM only on those pairs
    """
    max_pairs = get_settings().max_semantic_pairs

    # 1. Jaccard pre-filter — score all pairs (free, instant)
    scored_pairs: list[tuple[float, Agent, UUID, Agent]] = []
    for my_agent in my_agents:
        my_tags = my_agent.tags or []
        for cand_user_id, their_agents in candidate_agents.items():
            for their_agent in their_agents:
                jac = jaccard_similarity(my_tags, their_agent.tags or [])
                scored_pairs.append((jac, my_agent, cand_user_id, their_agent))

    if not scored_pairs:
        return []

    # 2. Sort by Jaccard DESC, take top N for LLM evaluation
    scored_pairs.sort(key=lambda p: p[0], reverse=True)
    top_pairs = scored_pairs[:max_pairs]

    # 3. LLM evaluation on selected pairs (parallel)
    async def score_pair(my_a: Agent, their_a: Agent) -> float:
        return await llm_similarity(
            my_a.name, my_a.description, my_a.tags or [],
            their_a.name, their_a.description, their_a.tags or [],
        )

    llm_scores = await asyncio.gather(
        *[score_pair(my_a, their_a) for _, my_a, _, their_a in top_pairs]
    )

    candidates: list[MatchCandidate] = []
    for (_, my_agent, cand_user_id, their_agent), score in zip(
        top_pairs, llm_scores, strict=True
    ):
        if score < min_similarity:
            continue
        candidates.append(
            MatchCandidate(
                user_id=cand_user_id,
                agent_id=their_agent.id,
                my_agent_id=my_agent.id,
                similarity_score=score,
                distance_m=distances[cand_user_id],
                display_name=user_names.get(cand_user_id, ""),
                agent_name=their_agent.name,
            )
        )
    candidates.sort(key=lambda c: c.similarity_score, reverse=True)
    return candidates


async def _get_active_agents(
    session: AsyncSession, user_id: UUID
) -> list[Agent]:
    """Get all active agents for a user, ordered by most recently activated first."""
    stmt = (
        select(Agent)
        .join(UserAgent, UserAgent.agent_id == Agent.id)
        .where(UserAgent.user_id == user_id, UserAgent.is_active.is_(True))
        .order_by(UserAgent.activated_at.desc())
    )
    result = await session.execute(stmt)
    return list(result.scalars())


async def _get_active_agents_bulk(
    session: AsyncSession, user_ids: list[UUID]
) -> dict[UUID, list[Agent]]:
    """Get all active agents for multiple users, grouped by user_id.
    Within each user, agents are ordered by most recently activated first."""
    stmt = (
        select(UserAgent.user_id, Agent)
        .join(Agent, Agent.id == UserAgent.agent_id)
        .where(
            UserAgent.user_id.in_(user_ids),
            UserAgent.is_active.is_(True),
        )
        .order_by(UserAgent.activated_at.desc())
    )
    result = await session.execute(stmt)
    agents_by_user: dict[UUID, list[Agent]] = {}
    for uid, agent in result.all():
        agents_by_user.setdefault(uid, []).append(agent)
    return agents_by_user
