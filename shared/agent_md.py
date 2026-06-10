"""Agent.md format — Pydantic schema, parser, renderer.

Islume agents are defined by `agents/{user_uuid}/{slug}.md` files which use
YAML frontmatter + markdown body. The DB row is the runtime source of truth;
files are export-only mirrors written from `scripts/seed_db.py` and the
agent CRUD API.

This module never reads from a path — callers pass file contents as a string.
That keeps path traversal out of the parsing layer (the CLI validator in
`scripts/validate_agent_md.py` is responsible for path checks).
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import yaml
from pydantic import BaseModel, Field, field_validator, model_validator

SCHEMA_VERSION = 1
MAX_FRONTMATTER_BYTES = 16 * 1024
MAX_BODY_CHARS = 8000
SLUG_RE = re.compile(r"^[a-z0-9_]{1,50}$")

GoalCategory = Literal[
    "dating",
    "networking",
    "companionship",
    "collaboration",
    "casual_chat",
    "mentorship",
    "recruiting",
    "job_seeking",
]
InteractionMode = Literal["online_only", "offline_ok", "offline_preferred"]
RelationshipIntent = Literal[
    "casual", "romantic", "professional", "friendship", "open"
]
Formality = Literal["casual", "polite", "formal"]


class Boundaries(BaseModel):
    avoid_topics: list[str] = Field(default_factory=list)
    language: str
    fallback_languages: list[str] = Field(default_factory=list)
    formality: Formality = "polite"
    nsfw: bool = False


class Phase(BaseModel):
    turns: str
    target: str


class ConversationPhases(BaseModel):
    warmup: Phase
    discovery: Phase
    bonding: Phase


class OfflineMeeting(BaseModel):
    allowed: bool = True
    preferred_settings: list[str] = Field(default_factory=list)
    avoid_settings: list[str] = Field(default_factory=list)
    duration_hint: str | None = None


class Escalation(BaseModel):
    initial_turns: int = Field(default=30, ge=1, le=500)
    continue_threshold: float = Field(default=0.6, ge=0, le=1)
    extended_turns: int = Field(default=30, ge=0, le=500)
    offline_threshold: float = Field(default=0.8, ge=0, le=1)
    offline_meeting: OfflineMeeting = Field(default_factory=OfflineMeeting)

    @model_validator(mode="after")
    def _thresholds_ordered(self) -> Escalation:
        if self.continue_threshold > self.offline_threshold:
            raise ValueError(
                "continue_threshold must be <= offline_threshold"
            )
        return self


class Safety(BaseModel):
    refuse_personal_info_share: bool = True
    require_owner_confirmation_for: list[str] = Field(default_factory=list)
    redline_topics: list[str] = Field(default_factory=list)


class Location(BaseModel):
    base_lat: float = Field(ge=-90, le=90)
    base_lon: float = Field(ge=-180, le=180)
    base_label: str | None = None
    travel_radius_km: float = Field(gt=0, le=500)
    preferred_areas: list[str] = Field(default_factory=list)


class Availability(BaseModel):
    active_hours: str
    timezone: str
    active_days: list[str] = Field(default_factory=list)

    @field_validator("timezone")
    @classmethod
    def _valid_tz(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except ZoneInfoNotFoundError as e:
            raise ValueError(f"Unknown IANA timezone: {v}") from e
        return v


class LLMSettings(BaseModel):
    model: str
    temperature: float = Field(ge=0, le=2)
    max_tokens_per_turn: int = Field(gt=0, le=4000)


Sex = Literal["male", "female", "nonbinary", "other"]


class Demographics(BaseModel):
    """Optional persona demographics — every field nullable.

    The whole block can also be `None` on the parent frontmatter when the
    user has not entered any demographics info.
    """
    height_cm: int | None = Field(None, ge=50, le=260)
    sex: Sex | None = None
    age: int | None = Field(None, ge=1, le=150)
    race: str | None = Field(None, max_length=50)
    notes: str | None = Field(None, max_length=400)

    def is_empty(self) -> bool:
        return (
            self.height_cm is None
            and self.sex is None
            and self.age is None
            and not self.race
            and not self.notes
        )


class Preferences(BaseModel):
    """Optional persona preferences (food/movies/novels + worldviews)."""
    favorite_foods: list[str] = Field(default_factory=list)
    favorite_movies: list[str] = Field(default_factory=list)
    favorite_novels: list[str] = Field(default_factory=list)
    life_view: str | None = Field(None, max_length=600)
    religion_view: str | None = Field(None, max_length=400)
    work_view: str | None = Field(None, max_length=400)

    def is_empty(self) -> bool:
        return (
            not self.favorite_foods
            and not self.favorite_movies
            and not self.favorite_novels
            and not self.life_view
            and not self.religion_view
            and not self.work_view
        )


class Translation(BaseModel):
    """Per-locale overrides for user-facing persona content.

    Every field is optional: an absent field falls back to the base English
    column. A locale entry with all fields empty is treated as "no translation"
    and dropped on render.
    """
    name: str | None = Field(None, max_length=100)
    description: str | None = Field(None, max_length=500)
    persona_prompt: str | None = Field(None, max_length=MAX_BODY_CHARS)
    tags: list[str] = Field(default_factory=list)

    def is_empty(self) -> bool:
        return (
            not self.name
            and not self.description
            and not self.persona_prompt
            and not self.tags
        )


class Reference(BaseModel):
    """A reference document loaded conditionally during conversation.

    Files live at `agents/{user_uuid}/{slug}/references/{name}.md`. The
    worker decides whether to inject a reference based on `load_when` and
    the current escalation phase, then truncates to fit the budget.
    """
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(max_length=200)
    load_when: Literal["always", "extended_phase", "offline_offer"]
    priority: int = Field(default=5, ge=1, le=10)
    max_chars: int = Field(default=2000, ge=100, le=8000)

    @field_validator("name")
    @classmethod
    def _ref_name_format(cls, v: str) -> str:
        if not re.fullmatch(r"[a-z0-9_]+", v):
            raise ValueError(
                f"reference name must match [a-z0-9_]+, got {v!r}"
            )
        return v


class AgentFrontmatter(BaseModel):
    schema_version: int = SCHEMA_VERSION
    revision: int = Field(default=1, ge=1)

    name: str = Field(min_length=1, max_length=100)
    slug: str
    agent_id: UUID
    description: str = Field(min_length=1, max_length=500)

    owner_user_id: UUID
    owner_display: str = Field(min_length=1, max_length=100)

    goal: str = Field(max_length=300)
    goal_category: GoalCategory
    interaction_mode: InteractionMode
    relationship_intent: RelationshipIntent
    compatible_intents: list[RelationshipIntent]

    tags: list[str] = Field(default_factory=list)
    topics_of_interest: list[str] = Field(default_factory=list)

    boundaries: Boundaries
    conversation_phases: ConversationPhases
    escalation: Escalation
    safety: Safety
    location: Location
    availability: Availability
    llm: LLMSettings
    references: list[Reference] = Field(default_factory=list)

    # Optional persona detail. Both blocks are None when the user hasn't
    # entered anything — keeps the YAML compact for default templates.
    demographics: Demographics | None = None
    preferences: Preferences | None = None

    # Optional per-locale persona content (e.g. {"ko": Translation(...)}).
    # None when English-only — dropped on render so existing files round-trip.
    i18n: dict[str, Translation] | None = None

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        if not SLUG_RE.match(v):
            raise ValueError(
                f"slug must match {SLUG_RE.pattern}, got {v!r}"
            )
        return v

    @field_validator("tags", "topics_of_interest")
    @classmethod
    def _normalize_tag_list(cls, v: list[str]) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []
        for raw in v:
            t = raw.strip().lower()
            if not t or t in seen:
                continue
            seen.add(t)
            out.append(t)
        return out

    @model_validator(mode="after")
    def _intent_self_compatible(self) -> AgentFrontmatter:
        if self.relationship_intent not in self.compatible_intents:
            raise ValueError(
                "compatible_intents must include relationship_intent "
                f"({self.relationship_intent!r})"
            )
        return self


_DELIMITER = "---"


def parse_agent_md(text: str) -> tuple[AgentFrontmatter, str]:
    """Parse Agent.md content into (frontmatter, body).

    Raises ValueError on malformed input. Body whitespace is stripped on
    both ends so round-trip is stable.
    """
    if not text.startswith(_DELIMITER):
        raise ValueError("Agent.md must start with '---' frontmatter delimiter")

    parts = text.split(_DELIMITER, 2)
    if len(parts) < 3:
        raise ValueError("Agent.md missing closing '---' for frontmatter")

    _, fm_text, body_text = parts
    if len(fm_text.encode("utf-8")) > MAX_FRONTMATTER_BYTES:
        raise ValueError(
            f"frontmatter exceeds {MAX_FRONTMATTER_BYTES} bytes"
        )

    try:
        fm_data = yaml.safe_load(fm_text)
    except yaml.YAMLError as e:
        raise ValueError(f"frontmatter YAML parse error: {e}") from e
    if not isinstance(fm_data, dict):
        raise ValueError("frontmatter must be a YAML mapping")

    fm = AgentFrontmatter.model_validate(fm_data)
    body = body_text.strip()
    if len(body) > MAX_BODY_CHARS:
        raise ValueError(f"body exceeds {MAX_BODY_CHARS} chars")
    return fm, body


def render_agent_md(fm: AgentFrontmatter, body: str) -> str:
    """Serialize (frontmatter, body) into a stable Agent.md string."""
    fm_dict = fm.model_dump(mode="json", exclude_none=False)
    # Optional top-level blocks: drop the key entirely when unset so older
    # files (which never had demographics/preferences) keep round-tripping.
    for k in ("demographics", "preferences", "i18n"):
        if fm_dict.get(k) is None:
            fm_dict.pop(k, None)
    fm_yaml = yaml.safe_dump(
        fm_dict,
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=False,
    )
    return f"{_DELIMITER}\n{fm_yaml}{_DELIMITER}\n\n{body.strip()}\n"


_GEOHASH_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"


def encode_geohash(lat: float, lon: float, precision: int = 5) -> str:
    """Encode (lat, lon) as a geohash string at the given precision.

    Implements the standard base32 geohash algorithm. Precision 5 gives
    ≈4.9 km × 4.9 km cells, suitable for coarse location matching while
    hiding exact user coordinates.
    """
    if not -90 <= lat <= 90:
        raise ValueError(f"lat out of range: {lat}")
    if not -180 <= lon <= 180:
        raise ValueError(f"lon out of range: {lon}")

    lat_lo, lat_hi = -90.0, 90.0
    lon_lo, lon_hi = -180.0, 180.0
    bit, ch = 0, 0
    even = True
    out: list[str] = []
    while len(out) < precision:
        if even:
            mid = (lon_lo + lon_hi) / 2
            if lon >= mid:
                ch = (ch << 1) | 1
                lon_lo = mid
            else:
                ch = ch << 1
                lon_hi = mid
        else:
            mid = (lat_lo + lat_hi) / 2
            if lat >= mid:
                ch = (ch << 1) | 1
                lat_lo = mid
            else:
                ch = ch << 1
                lat_hi = mid
        even = not even
        bit += 1
        if bit == 5:
            out.append(_GEOHASH_BASE32[ch])
            bit, ch = 0, 0
    return "".join(out)


def references_from_meta(meta: list[dict] | None) -> list[Reference]:
    """Hydrate stored DB metadata into Reference models. Empty list on None."""
    if not meta:
        return []
    return [Reference.model_validate(m) for m in meta]


def load_references(
    references_dir: Path,
    selected: list[Reference],
    token_budget_chars: int,
) -> str:
    """Load and concatenate selected references, capped by total char budget.

    Each ref is read from `{references_dir}/{name}.md`, truncated to its
    own `max_chars`, then prepended to the running output until the global
    budget is exhausted. Higher `priority` (1=highest, 10=lowest) wins.

    Refuses to follow symlinks and never reads outside the resolved
    references_dir (path traversal defence).
    """
    if not selected or token_budget_chars <= 0 or not references_dir.is_dir():
        return ""

    base = references_dir.resolve()
    chunks: list[str] = []
    remaining = token_budget_chars
    for ref in sorted(selected, key=lambda r: r.priority):
        path = (references_dir / f"{ref.name}.md").resolve()
        try:
            path.relative_to(base)
        except ValueError:
            continue
        if path.is_symlink() or not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        snippet = text[: ref.max_chars]
        if len(snippet) > remaining:
            snippet = snippet[:remaining]
        if not snippet:
            break
        chunks.append(f"### Reference: {ref.name}\n{snippet}".rstrip())
        remaining -= len(snippet)
        if remaining <= 0:
            break
    return "\n\n".join(chunks)


def select_references(
    refs: list[Reference],
    *,
    phase: Literal["initial", "extended", "offline"],
) -> list[Reference]:
    """Pick which references should load given the current escalation phase."""
    out: list[Reference] = []
    for r in refs:
        if r.load_when == "always":
            out.append(r)
        elif r.load_when == "extended_phase" and phase in ("extended", "offline"):
            out.append(r)
        elif r.load_when == "offline_offer" and phase == "offline":
            out.append(r)
    return out


def slugify(name: str) -> str:
    """Convert a display name into a slug. Empty result raises ValueError.

    Collisions are the caller's responsibility (e.g. append _2 suffix).
    """
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = s.strip("_")
    s = s[:50]
    if not s:
        raise ValueError(f"name {name!r} produced empty slug")
    return s


def is_within(child: Path, base: Path) -> bool:
    """Path traversal guard — true iff `child` resolves under `base`.

    Mirrors `scripts/validate_agent_md.py:_is_within`. `base` must already
    exist on disk; `child` may not (e.g. a path we are about to create) —
    in that case strict resolution is skipped for the child only.
    """
    try:
        base_resolved = base.resolve(strict=True)
    except (OSError, FileNotFoundError):
        return False
    try:
        child_resolved = child.resolve()
    except OSError:
        return False
    try:
        child_resolved.relative_to(base_resolved)
        return True
    except ValueError:
        return False


def agent_md_path(base: Path, owner_id: UUID, slug: str) -> Path:
    """Return `{base}/{owner_id}/{slug}.md` after a traversal-safety check.

    Raises ValueError if `slug` is not in canonical form or if the resolved
    path escapes `base`. Does not create the file or its parent directory.
    """
    if not SLUG_RE.match(slug):
        raise ValueError(f"slug must match {SLUG_RE.pattern}, got {slug!r}")
    user_dir = base / str(owner_id)
    candidate = user_dir / f"{slug}.md"
    base.mkdir(parents=True, exist_ok=True)
    if not is_within(user_dir if user_dir.exists() else base, base):
        raise ValueError("path escapes agents base directory")
    # Final string check on the candidate too (slug already constrained, but
    # defence in depth).
    rel = candidate.relative_to(base)
    if any(part in ("..", "") for part in rel.parts):
        raise ValueError(f"unsafe path components in {rel}")
    return candidate


# --- Defaults shared by seed + matching service when synthesising frontmatter ---

_TAG_TO_GOAL_CATEGORY: list[tuple[set[str], GoalCategory]] = [
    ({"music", "jazz", "vinyl", "piano", "classical"}, "casual_chat"),
    ({"coffee", "brewing", "foodie", "cooking", "recipes", "BBQ"}, "casual_chat"),
    ({"dating", "romance"}, "dating"),
    ({"design", "art", "creative", "typography"}, "collaboration"),
    ({"teaching", "classical", "piano", "education"}, "mentorship"),
    ({"backend", "frontend", "python", "distributed_systems", "system_design"}, "networking"),
    ({"sustainability", "eco", "zero-waste", "environment"}, "collaboration"),
]
_DEFAULT_GOAL_CATEGORY: GoalCategory = "casual_chat"
_STANDARD_REDLINE_TOPICS = ["minor_dating", "drug_use", "violence", "self_harm"]
_STANDARD_OWNER_CONFIRM_FOR = [
    "offline_meeting",
    "phone_exchange",
    "external_link_share",
]


def pick_goal_category(tags: list[str]) -> GoalCategory:
    tagset = {t.lower() for t in tags}
    for cluster, cat in _TAG_TO_GOAL_CATEGORY:
        if tagset & cluster:
            return cat
    return _DEFAULT_GOAL_CATEGORY


def frontmatter_from_agent(
    agent: object,
    owner: object,
    *,
    base_lat: float | None = None,
    base_lon: float | None = None,
    references: list[Reference] | None = None,
) -> AgentFrontmatter:
    """Compose v2 frontmatter from a DB Agent + User row.

    Used by `scripts/seed_db.py` and the matching service create/update
    paths so both produce the same frontmatter shape. v2 columns already
    set on `agent` win; otherwise conservative defaults are filled in.

    `agent` and `owner` are typed as `object` to avoid an import cycle
    (the SQLAlchemy models live in `shared.models`); attributes are
    accessed by name.
    """
    name = agent.name
    description = agent.description or ""
    persona_prompt = getattr(agent, "persona_prompt", "") or ""
    tags = list(getattr(agent, "tags", None) or [])

    slug_value = getattr(agent, "slug", None) or slugify(name)
    goal = getattr(agent, "goal", None) or description[:300] or persona_prompt[:300] or name
    goal_category: GoalCategory = (
        getattr(agent, "goal_category", None) or pick_goal_category(tags)
    )
    relationship_intent: RelationshipIntent = (
        getattr(agent, "relationship_intent", None) or "open"
    )
    interaction_mode: InteractionMode = (
        getattr(agent, "interaction_mode", None) or "online_only"
    )
    compatible_intents = list(
        getattr(agent, "compatible_intents", None)
        or ["open", "friendship", "professional", "casual"]
    )
    if relationship_intent not in compatible_intents:
        compatible_intents = [relationship_intent, *compatible_intents]
    topics = list(getattr(agent, "topics_of_interest", None) or [])

    boundaries_dict = getattr(agent, "boundaries", None) or {
        "avoid_topics": ["politics", "religion"],
        "language": "en-AU",
        "fallback_languages": ["en-US"],
        "formality": "polite",
        "nsfw": False,
    }
    phases_dict = getattr(agent, "conversation_phases", None) or {
        "warmup": {"turns": "1-7", "target": "discover topical depth"},
        "discovery": {"turns": "8-18", "target": "find shared axis"},
        "bonding": {"turns": "19-30", "target": "test scenario fit"},
    }
    escalation_dict = getattr(agent, "escalation_policy", None) or {
        "initial_turns": 30,
        "continue_threshold": 0.6,
        "extended_turns": 30,
        "offline_threshold": 0.8,
        "offline_meeting": {
            "allowed": True,
            "preferred_settings": ["coffee_shop", "park"],
            "avoid_settings": ["private_residence"],
            "duration_hint": "1 hour, public place",
        },
    }
    safety_dict = getattr(agent, "safety", None) or {
        "refuse_personal_info_share": True,
        "require_owner_confirmation_for": list(_STANDARD_OWNER_CONFIRM_FOR),
        "redline_topics": list(_STANDARD_REDLINE_TOPICS),
    }
    availability_dict = getattr(agent, "availability", None) or {
        "active_hours": "09:00-22:00",
        "timezone": "Australia/Brisbane",
        "active_days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    }
    llm_dict = getattr(agent, "llm_settings", None) or {
        "model": getattr(owner, "preferred_model", None) or "claude-sonnet-4-5",
        "temperature": 0.7,
        "max_tokens_per_turn": 300,
    }

    suburb = getattr(owner, "suburb", None)
    location_label = getattr(agent, "location_label", None) or suburb
    final_lat = base_lat if base_lat is not None else -27.4679
    final_lon = base_lon if base_lon is not None else 153.0281
    location = Location(
        base_lat=final_lat,
        base_lon=final_lon,
        base_label=location_label,
        travel_radius_km=10.0,
        preferred_areas=[suburb] if suburb else [],
    )

    refs_meta = getattr(agent, "references_meta", None)
    if references is None:
        references = references_from_meta(refs_meta)

    demographics_dict = getattr(agent, "demographics", None)
    demographics_obj = (
        Demographics.model_validate(demographics_dict) if demographics_dict else None
    )
    if demographics_obj is not None and demographics_obj.is_empty():
        demographics_obj = None

    preferences_dict = getattr(agent, "preferences", None)
    preferences_obj = (
        Preferences.model_validate(preferences_dict) if preferences_dict else None
    )
    if preferences_obj is not None and preferences_obj.is_empty():
        preferences_obj = None

    translations_dict = getattr(agent, "translations", None)
    i18n_obj: dict[str, Translation] | None = None
    if translations_dict:
        built: dict[str, Translation] = {}
        for locale, payload in translations_dict.items():
            if not isinstance(payload, dict):
                continue
            tr = Translation.model_validate(payload)
            if not tr.is_empty():
                built[locale] = tr
        i18n_obj = built or None

    revision = int(getattr(agent, "revision", None) or 1)
    schema_version = int(getattr(agent, "schema_version", None) or SCHEMA_VERSION)

    return AgentFrontmatter(
        schema_version=schema_version,
        revision=revision,
        name=name,
        slug=slug_value,
        agent_id=agent.id,
        description=description[:500] or name,
        owner_user_id=owner.id,
        owner_display=owner.display_name,
        goal=goal,
        goal_category=goal_category,
        interaction_mode=interaction_mode,
        relationship_intent=relationship_intent,
        compatible_intents=compatible_intents,
        tags=tags,
        topics_of_interest=topics,
        boundaries=Boundaries.model_validate(boundaries_dict),
        conversation_phases=ConversationPhases.model_validate(phases_dict),
        escalation=Escalation.model_validate(escalation_dict),
        safety=Safety.model_validate(safety_dict),
        location=location,
        availability=Availability.model_validate(availability_dict),
        llm=LLMSettings.model_validate(llm_dict),
        references=references,
        demographics=demographics_obj,
        preferences=preferences_obj,
        i18n=i18n_obj,
    )


def apply_frontmatter_to_agent(agent: object, fm: AgentFrontmatter) -> None:
    """Mirror an `AgentFrontmatter` into a DB Agent row's columns.

    Used by both seed and the markdown PUT route so the file → DB sync is
    identical in both code paths. Mutates `agent` in place.
    """
    agent.slug = fm.slug
    agent.name = fm.name
    agent.description = fm.description
    agent.tags = list(fm.tags)
    agent.goal = fm.goal
    agent.goal_category = fm.goal_category
    agent.interaction_mode = fm.interaction_mode
    agent.relationship_intent = fm.relationship_intent
    agent.compatible_intents = list(fm.compatible_intents)
    agent.topics_of_interest = list(fm.topics_of_interest)
    agent.boundaries = fm.boundaries.model_dump()
    agent.conversation_phases = fm.conversation_phases.model_dump()
    agent.escalation_policy = fm.escalation.model_dump()
    agent.safety = fm.safety.model_dump()
    agent.availability = fm.availability.model_dump()
    agent.llm_settings = fm.llm.model_dump()
    agent.location_geohash5 = encode_geohash(
        fm.location.base_lat, fm.location.base_lon, 5
    )
    agent.location_label = fm.location.base_label
    agent.schema_version = fm.schema_version
    agent.references_meta = (
        [r.model_dump() for r in fm.references] if fm.references else None
    )
    if fm.demographics is not None and not fm.demographics.is_empty():
        agent.demographics = fm.demographics.model_dump(exclude_none=True)
    else:
        agent.demographics = None
    if fm.preferences is not None and not fm.preferences.is_empty():
        agent.preferences = fm.preferences.model_dump(exclude_none=True)
    else:
        agent.preferences = None
    if fm.i18n:
        cleaned = {
            loc: tr.model_dump(exclude_none=True)
            for loc, tr in fm.i18n.items()
            if not tr.is_empty()
        }
        agent.translations = cleaned or None
    else:
        agent.translations = None
