"""SQLAlchemy ORM models for Islume."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    display_name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(255), unique=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    last_seen_at: Mapped[datetime | None] = mapped_column(nullable=True)

    # Profile
    sex: Mapped[str | None] = mapped_column(String(20), nullable=True)
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    job: Mapped[str | None] = mapped_column(String(100), nullable=True)
    suburb: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Settings
    find_radius_m: Mapped[int] = mapped_column(Integer, default=5000)
    allow_1on1_chat: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_group_chat: Mapped[bool] = mapped_column(Boolean, default=True)
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Direct-chat preferences. `chatting_enabled` is the master toggle for
    # receiving direct chats (supersedes allow_1on1_chat as the live gate);
    # `notification_enabled` controls whether push toasts/badges are shown.
    notification_enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true"
    )
    chatting_enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true"
    )

    # Tier & model
    tier: Mapped[str] = mapped_column(String(20), default="free")
    preferred_model: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Session & affinity settings
    auto_approve_affinity: Mapped[bool] = mapped_column(Boolean, default=False)
    default_max_turns: Mapped[int] = mapped_column(Integer, default=30)
    affinity_check_turns: Mapped[int] = mapped_column(Integer, default=15)
    max_concurrent_chats: Mapped[int] = mapped_column(Integer, default=10)

    # Search settings
    search_mode: Mapped[str] = mapped_column(String(20), default="exact_tags")
    min_similarity: Mapped[float] = mapped_column(Float, default=0.3)

    # Island (per-user procedural world)
    island_seed: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    house_x: Mapped[int | None] = mapped_column(Integer, nullable=True)
    house_y: Mapped[int | None] = mapped_column(Integer, nullable=True)

    agents: Mapped[list["UserAgent"]] = relationship(back_populates="user")


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    persona_prompt: Mapped[str] = mapped_column(Text)
    tone: Mapped[str] = mapped_column(String(50), default="friendly")
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    # === Agent.md v2 fields (Phase 1 — schema only, services don't read yet) ===
    slug: Mapped[str | None] = mapped_column(String(50), nullable=True)
    goal: Mapped[str | None] = mapped_column(Text, nullable=True)
    goal_category: Mapped[str | None] = mapped_column(String(30), nullable=True)
    interaction_mode: Mapped[str | None] = mapped_column(String(30), nullable=True)
    relationship_intent: Mapped[str | None] = mapped_column(String(30), nullable=True)
    compatible_intents: Mapped[list[str] | None] = mapped_column(
        ARRAY(String), nullable=True
    )
    topics_of_interest: Mapped[list[str] | None] = mapped_column(
        ARRAY(String), nullable=True
    )
    boundaries: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    conversation_phases: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    escalation_policy: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    safety: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    availability: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    llm_settings: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    location_geohash5: Mapped[str | None] = mapped_column(String(5), nullable=True)
    location_label: Mapped[str | None] = mapped_column(String(100), nullable=True)
    agent_md_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    schema_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    # PR-5: list[Reference] metadata; reference *bodies* live in the
    # filesystem at agents/{user_uuid}/{slug}/references/{name}.md.
    references_meta: Mapped[list[dict] | None] = mapped_column(JSONB, nullable=True)
    # Optional persona detail (templates may populate, users may leave empty).
    # `none_as_null=True` so Python None maps to SQL NULL — keeps `IS NULL`
    # queries honest, matching what frontmatter_from_agent expects when
    # treating an absent block as "no info entered".
    demographics: Mapped[dict | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )
    preferences: Mapped[dict | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )

    # MCP-style intent plugins attached to this agent. Each entry:
    # {"plugin": "bartering", "policy": {...}}
    attached_plugins: Mapped[list[dict] | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )

    # Per-locale overrides for user-facing persona content. Shape:
    # {"ko": {"name": ..., "description": ..., "persona_prompt": ..., "tags": [...]}}.
    # Absent locales/fields fall back to the base English columns. `none_as_null`
    # keeps "no translation entered" honest as SQL NULL, matching demographics.
    translations: Mapped[dict | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )

    __table_args__ = (
        Index("ix_agents_goal_category", "goal_category"),
        Index("ix_agents_interaction_mode", "interaction_mode"),
        Index("ix_agents_relationship_intent", "relationship_intent"),
        Index("ix_agents_location_geohash5", "location_geohash5"),
        Index(
            "ix_agents_compatible_intents_gin",
            "compatible_intents",
            postgresql_using="gin",
        ),
        Index(
            "ix_agents_topics_of_interest_gin",
            "topics_of_interest",
            postgresql_using="gin",
        ),
    )


class UserAgent(Base):
    __tablename__ = "user_agents"

    id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    agent_id: Mapped[UUID] = mapped_column(ForeignKey("agents.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    activated_at: Mapped[datetime] = mapped_column(server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="agents")


class MatchSession(Base):
    __tablename__ = "match_sessions"

    id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    user_a_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    user_b_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    agent_a_id: Mapped[UUID] = mapped_column(ForeignKey("agents.id"))
    agent_b_id: Mapped[UUID] = mapped_column(ForeignKey("agents.id"))
    similarity_score: Mapped[float] = mapped_column(Float)
    match_context: Mapped[str] = mapped_column(Text, default="")
    # 30, not 20: "awaiting_owner_confirmation" is 27 chars
    status: Mapped[str] = mapped_column(String(30), default="active")
    turn_count: Mapped[int] = mapped_column(Integer, default=0)
    max_turns: Mapped[int] = mapped_column(Integer, default=100)
    started_at: Mapped[datetime] = mapped_column(server_default=func.now())
    ended_at: Mapped[datetime | None] = mapped_column(nullable=True)

    # Affinity scoring
    affinity_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    affinity_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    affinity_recommendation: Mapped[str | None] = mapped_column(
        String(20), nullable=True
    )
    affinity_checked_at: Mapped[datetime | None] = mapped_column(nullable=True)
    # Per-user affinity response tracking
    user_a_affinity_response: Mapped[str | None] = mapped_column(
        String(20), nullable=True
    )
    user_b_affinity_response: Mapped[str | None] = mapped_column(
        String(20), nullable=True
    )

    # Intent plugin domain — bartering and future plugins write here.
    # "agreed" / "withdrawn" / None. shared_references: [{kind, url, label}, ...]
    deal_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    shared_references: Mapped[list[dict] | None] = mapped_column(JSONB, nullable=True)


class ConversationTurn(Base):
    __tablename__ = "conversation_turns"

    id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(ForeignKey("match_sessions.id"))
    agent_id: Mapped[UUID] = mapped_column(ForeignKey("agents.id"))
    turn_number: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    model_used: Mapped[str] = mapped_column(String(50))
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    # Tool calls produced by the LLM during this turn — list of:
    # {"id": "...", "name": "propose_price", "arguments": {...},
    #  "status": "auto_confirmed" | "pending" | "user_confirmed" | "user_rejected" | "auto_rejected" | "expired",
    #  "plugin": "bartering"}
    tool_calls: Mapped[list[dict] | None] = mapped_column(JSONB, nullable=True)


class ChatRoom(Base):
    __tablename__ = "chat_rooms"

    id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    room_type: Mapped[str] = mapped_column(String(20))  # "direct" or "group"
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ChatMember(Base):
    __tablename__ = "chat_members"

    id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    room_id: Mapped[UUID] = mapped_column(ForeignKey("chat_rooms.id"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    joined_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    room_id: Mapped[UUID] = mapped_column(ForeignKey("chat_rooms.id"))
    sender_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Wallet(Base):
    __tablename__ = "wallets"
    __table_args__ = (
        # System wallet (all-zeros user) is the treasury and may go negative.
        # IS NOT DISTINCT FROM: user_id is nullable; NULL must not bypass the CHECK.
        CheckConstraint(
            "balance >= 0 OR user_id IS NOT DISTINCT FROM"
            " '00000000-0000-0000-0000-000000000000'::uuid",
            name="ck_wallets_balance_non_negative",
        ),
    )

    id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id"), unique=True, nullable=True
    )
    public_key: Mapped[bytes] = mapped_column(LargeBinary)
    encrypted_private_key: Mapped[bytes] = mapped_column(LargeBinary)
    balance: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class LedgerEntry(Base):
    __tablename__ = "ledger_entries"
    __table_args__ = (
        # Doubles as the idempotency guard: tx_id is derived from the
        # client's idempotency key, so a retried transfer hits this constraint.
        UniqueConstraint("tx_id", "account_id", name="uq_ledger_entries_tx_account"),
        Index("ix_ledger_entries_account_created", "account_id", "created_at"),
        CheckConstraint("amount <> 0", name="ck_ledger_entries_amount_nonzero"),
        CheckConstraint("currency = 'ISL'", name="ck_ledger_entries_currency_isl"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tx_id: Mapped[UUID] = mapped_column(PgUUID, nullable=False)
    account_id: Mapped[UUID] = mapped_column(ForeignKey("wallets.id"), nullable=False)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="ISL")
    tx_type: Mapped[str] = mapped_column(String(50), nullable=False)
    tx_metadata: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    signature: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Inventory(Base):
    __tablename__ = "inventory"

    user_id: Mapped[UUID] = mapped_column(
        PgUUID, ForeignKey("users.id"), primary_key=True
    )
    item_type: Mapped[str] = mapped_column(String(100), primary_key=True)
    quantity: Mapped[int] = mapped_column(Integer, default=0)


class Asset(Base):
    __tablename__ = "assets"

    asset_id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    owner_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    asset_type: Mapped[str] = mapped_column(String(100))
    properties: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class AssetTransfer(Base):
    __tablename__ = "asset_transfers"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    asset_id: Mapped[UUID] = mapped_column(ForeignKey("assets.asset_id"))
    from_user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    to_user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    tx_id: Mapped[UUID | None] = mapped_column(PgUUID, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class VisitSession(Base):
    __tablename__ = "visit_sessions"
    __table_args__ = (
        Index("ix_visit_sessions_visitor_active", "visitor_id", "status"),
        Index("ix_visit_sessions_host_active", "host_id", "status"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    visitor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    host_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(20), default="active")
    visitor_x: Mapped[int | None] = mapped_column(Integer, nullable=True)
    visitor_y: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[datetime] = mapped_column(server_default=func.now())
    arrived_at: Mapped[datetime | None] = mapped_column(nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now()
    )


class IslandVoxelMap(Base):
    __tablename__ = "island_voxel_maps"

    id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    island_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), unique=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    voxel_data: Mapped[bytes] = mapped_column(LargeBinary)
    heightmap: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    block_palette: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now()
    )


class IslandMapEdit(Base):
    __tablename__ = "island_map_edits"

    id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    island_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    editor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    changes: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class IslandTiledMap(Base):
    __tablename__ = "island_tiled_maps"
    __table_args__ = (
        Index("ix_island_tiled_maps_unique", "island_id", "map_key", unique=True),
    )

    id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    island_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    map_key: Mapped[str] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(Integer, default=1)
    map_data: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now()
    )


class IslandStage(Base):
    """A user-authored platformer stage (Mario Maker style), max 3 per island.

    status/cleared invariant: published implies cleared. Maintained by the
    API transitions only — PUT always resets to draft/uncleared, publish
    409s unless cleared.
    """

    __tablename__ = "island_stages"
    __table_args__ = (
        Index("ix_island_stages_unique", "island_id", "slot", unique=True),
    )

    id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    island_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    slot: Mapped[int] = mapped_column(Integer)  # 1..3, validated at the API layer
    status: Mapped[str] = mapped_column(String(16), default="draft")
    cleared: Mapped[bool] = mapped_column(Boolean, default=False)
    name: Mapped[str] = mapped_column(String(64))
    level_data: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now()
    )


class DirectMessage(Base):
    __tablename__ = "direct_messages"
    __table_args__ = (
        Index("ix_direct_messages_session_created", "visit_session_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    visit_session_id: Mapped[UUID] = mapped_column(ForeignKey("visit_sessions.id"))
    sender_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


# ---------------------------------------------------------------------------
# Intent plugin tables — written by bartering/job_seeking/offline_meetup plugins
# ---------------------------------------------------------------------------


class IntentProposal(Base):
    """One row per proposal emission (propose_price, counter_offer, ...).

    Status flow: "open" → "accepted" | "rejected" | "withdrawn" | "expired".
    Invariant: at most one "open" row per session at any time (enforced in handlers).
    """

    __tablename__ = "intent_proposals"
    __table_args__ = (
        Index("ix_intent_proposals_session_created", "session_id", "created_at"),
        Index("ix_intent_proposals_session_status", "session_id", "status"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(ForeignKey("match_sessions.id"))
    proposer_agent_id: Mapped[UUID] = mapped_column(ForeignKey("agents.id"))
    turn_number: Mapped[int] = mapped_column(Integer)
    plugin: Mapped[str] = mapped_column(String(50))
    proposal_type: Mapped[str] = mapped_column(
        String(30)
    )  # propose_price | counter_offer
    payload: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(20), default="open")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class IntentAgreement(Base):
    """Records a side accepting a proposal. Finalized=True when both sides agree."""

    __tablename__ = "intent_agreements"
    __table_args__ = (
        Index("ix_intent_agreements_session_created", "session_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(ForeignKey("match_sessions.id"))
    proposal_id: Mapped[UUID] = mapped_column(ForeignKey("intent_proposals.id"))
    accepting_agent_id: Mapped[UUID] = mapped_column(ForeignKey("agents.id"))
    finalized: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class PartnerEvaluation(Base):
    """One agent's evaluation of its conversation partner.

    Owner-private: rows are always filtered by user_id (the evaluating agent's
    owner) — the partner must never see the other side's verdicts. The shared
    MatchSession.affinity_* fields stay as the owner-agnostic score mirror;
    this table holds the category-specific verdicts.

    template: hobby | recruiting | job_seeking | dating | professional
    trigger: max_turns | session_end
    """

    __tablename__ = "partner_evaluations"
    __table_args__ = (
        Index("ix_partner_evaluations_user_created", "user_id", "created_at"),
        Index("ix_partner_evaluations_session_agent", "session_id", "agent_id"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(ForeignKey("match_sessions.id"))
    agent_id: Mapped[UUID] = mapped_column(ForeignKey("agents.id"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    evaluated_agent_id: Mapped[UUID] = mapped_column(ForeignKey("agents.id"))
    goal_category: Mapped[str | None] = mapped_column(String(30), nullable=True)
    template: Mapped[str] = mapped_column(String(20))
    verdicts: Mapped[dict] = mapped_column(JSONB, default=dict)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    turn_number: Mapped[int] = mapped_column(Integer)
    trigger: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Notification(Base):
    """Durable per-user notification (inbox row).

    The Redis user stream (stream:user:{id}) is live-only — the gateway reads
    from "$", so a user who is offline at publish time never sees the event.
    This table is the durable record; call sites insert a row in the SAME
    transaction as the state change, commit, then publish_user_event.
    """

    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_user_read", "user_id", "read_at"),
        Index("ix_notifications_user_created", "user_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    type: Mapped[str] = mapped_column(String(40))
    session_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("match_sessions.id"), nullable=True
    )
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    read_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ToolCallEvent(Base):
    """Audit row for every tool call (plugin-agnostic).

    Status: auto_confirmed | pending | user_confirmed | user_rejected | auto_rejected | expired.
    Pending rows are the work queue for owner confirmations.
    """

    __tablename__ = "tool_call_events"
    __table_args__ = (
        Index("ix_tool_call_events_session_created", "session_id", "created_at"),
        Index("ix_tool_call_events_user_status", "user_id", "status"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID, primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(ForeignKey("match_sessions.id"))
    turn_number: Mapped[int] = mapped_column(Integer)
    agent_id: Mapped[UUID] = mapped_column(ForeignKey("agents.id"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    plugin: Mapped[str] = mapped_column(String(50))
    tool_name: Mapped[str] = mapped_column(String(60))
    arguments: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(30))
    policy_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
