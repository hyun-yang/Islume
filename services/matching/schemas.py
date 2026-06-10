"""Pydantic schemas for the Map + Matching API."""
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from shared.intent_plugins import get_plugin


class PositionUpdate(BaseModel):
    longitude: float = Field(..., ge=-180, le=180)
    latitude: float = Field(..., ge=-90, le=90)


class IslandPosition(BaseModel):
    user_id: UUID
    longitude: float
    latitude: float
    distance_m: float | None = None
    display_name: str | None = None
    is_active: bool = True


class NearbyIslandsResponse(BaseModel):
    center: PositionUpdate
    radius_m: float
    islands: list[IslandPosition]


class MatchRequest(BaseModel):
    user_id: UUID
    radius_m: float = 5000.0
    min_similarity: float | None = None   # None = use user's saved setting
    search_mode: str | None = None        # None = use user's saved setting


class MatchCandidate(BaseModel):
    user_id: UUID
    agent_id: UUID
    my_agent_id: UUID
    similarity_score: float
    distance_m: float
    display_name: str = ""
    agent_name: str = ""


class MatchResponse(BaseModel):
    user_id: UUID
    candidates: list[MatchCandidate]
    selected: MatchCandidate | None


class UserProfile(BaseModel):
    """Read-only profile response."""

    id: UUID
    display_name: str
    email: str
    sex: str | None = None
    age: int | None = None
    job: str | None = None
    suburb: str | None = None
    find_radius_m: int = 5000
    allow_1on1_chat: bool = True
    allow_group_chat: bool = True
    is_visible: bool = True
    is_active: bool = True
    notification_enabled: bool = True
    chatting_enabled: bool = True
    tier: str = "free"
    preferred_model: str | None = None
    auto_approve_affinity: bool = False
    default_max_turns: int = 30
    affinity_check_turns: int = 15
    max_concurrent_chats: int = 10
    search_mode: str = "exact_tags"
    min_similarity: float = 0.3


class ProfileUpdate(BaseModel):
    """Partial update — all fields optional."""

    display_name: str | None = Field(None, max_length=100)
    sex: str | None = Field(None, max_length=20)
    age: int | None = Field(None, ge=1, le=150)
    job: str | None = Field(None, max_length=100)
    suburb: str | None = Field(None, max_length=100)
    find_radius_m: int | None = Field(None, ge=50, le=100000)
    allow_1on1_chat: bool | None = None
    allow_group_chat: bool | None = None
    notification_enabled: bool | None = None
    chatting_enabled: bool | None = None
    preferred_model: str | None = Field(None, max_length=50)
    auto_approve_affinity: bool | None = None
    default_max_turns: int | None = Field(None, ge=6, le=1000)
    affinity_check_turns: int | None = Field(None, ge=5, le=100)
    max_concurrent_chats: int | None = Field(None, ge=1, le=50)
    search_mode: str | None = Field(None, max_length=20)
    min_similarity: float | None = Field(None, ge=0.0, le=1.0)


class StatusUpdate(BaseModel):
    """Toggle active/visible status."""

    is_active: bool | None = None
    is_visible: bool | None = None


# --- Agent schemas ---


class AttachedPluginEntry(BaseModel):
    """One entry of `agents.attached_plugins` — `{"plugin": id, "policy": {...}}`.

    Only the plugin id is validated here; policy contents are checked at
    tool-call time by each plugin's `policy_check`.
    """

    plugin: str
    policy: dict = Field(default_factory=dict)

    @field_validator("plugin")
    @classmethod
    def _known_plugin(cls, v: str) -> str:
        if get_plugin(v) is None:
            raise ValueError(f"unknown plugin id: {v}")
        return v


class AgentResponse(BaseModel):
    id: UUID
    name: str
    description: str
    persona_prompt: str
    tone: str
    tags: list[str]
    is_active: bool
    created_at: str
    # v2 fields (nullable for v1 agents)
    goal: str | None = None
    goal_category: str | None = None
    interaction_mode: str | None = None
    relationship_intent: str | None = None
    compatible_intents: list[str] | None = None
    topics_of_interest: list[str] | None = None
    schema_version: int | None = None
    revision: int | None = None
    # Optional persona detail
    demographics: dict | None = None
    preferences: dict | None = None
    # Per-locale persona overrides + conversation boundaries (incl. language)
    translations: dict | None = None
    boundaries: dict | None = None
    # Intent plugins attached to this agent (raw JSONB shape)
    attached_plugins: list[dict] | None = None


class AgentCreate(BaseModel):
    name: str = Field(..., max_length=100)
    description: str
    persona_prompt: str
    tone: str = Field("friendly", max_length=50)
    tags: list[str] = []
    # Optional v2 fields — when omitted the row stays v1-shaped
    goal: str | None = Field(None, max_length=300)
    goal_category: str | None = Field(None, max_length=30)
    interaction_mode: str | None = Field(None, max_length=30)
    relationship_intent: str | None = Field(None, max_length=30)
    compatible_intents: list[str] | None = None
    topics_of_interest: list[str] | None = None
    demographics: dict | None = None
    preferences: dict | None = None
    translations: dict | None = None
    boundaries: dict | None = None
    attached_plugins: list[AttachedPluginEntry] | None = None


class AgentUpdate(BaseModel):
    name: str | None = Field(None, max_length=100)
    description: str | None = None
    persona_prompt: str | None = None
    tone: str | None = Field(None, max_length=50)
    tags: list[str] | None = None
    goal: str | None = Field(None, max_length=300)
    goal_category: str | None = Field(None, max_length=30)
    interaction_mode: str | None = Field(None, max_length=30)
    relationship_intent: str | None = Field(None, max_length=30)
    compatible_intents: list[str] | None = None
    topics_of_interest: list[str] | None = None
    demographics: dict | None = None
    preferences: dict | None = None
    translations: dict | None = None
    boundaries: dict | None = None
    attached_plugins: list[AttachedPluginEntry] | None = None


class MarkdownPayload(BaseModel):
    """Body of `PUT /agents/{id}/markdown`."""

    markdown: str = Field(..., min_length=3)


class AgentMarkdownResponse(BaseModel):
    """Body of `GET/PUT /agents/{id}/markdown`."""

    agent_id: UUID
    markdown: str
    revision: int
