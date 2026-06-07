"""add agent.md v2 columns

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-05-03

Adds Phase 1 Agent.md v2 columns to `agents` (all nullable, non-destructive).
Services do not read these yet — Phase 2 PR will wire them into worker prompts.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c3d4e5f6a7b8"
down_revision: str | Sequence[str] | None = "b2c3d4e5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("agents", sa.Column("slug", sa.String(length=50), nullable=True))
    op.add_column("agents", sa.Column("goal", sa.Text(), nullable=True))
    op.add_column("agents", sa.Column("goal_category", sa.String(length=30), nullable=True))
    op.add_column("agents", sa.Column("interaction_mode", sa.String(length=30), nullable=True))
    op.add_column("agents", sa.Column("relationship_intent", sa.String(length=30), nullable=True))
    op.add_column(
        "agents",
        sa.Column("compatible_intents", postgresql.ARRAY(sa.String()), nullable=True),
    )
    op.add_column(
        "agents",
        sa.Column("topics_of_interest", postgresql.ARRAY(sa.String()), nullable=True),
    )
    op.add_column("agents", sa.Column("boundaries", postgresql.JSONB(), nullable=True))
    op.add_column("agents", sa.Column("conversation_phases", postgresql.JSONB(), nullable=True))
    op.add_column("agents", sa.Column("escalation_policy", postgresql.JSONB(), nullable=True))
    op.add_column("agents", sa.Column("safety", postgresql.JSONB(), nullable=True))
    op.add_column("agents", sa.Column("availability", postgresql.JSONB(), nullable=True))
    op.add_column("agents", sa.Column("llm_settings", postgresql.JSONB(), nullable=True))
    op.add_column("agents", sa.Column("location_geohash5", sa.String(length=5), nullable=True))
    op.add_column("agents", sa.Column("location_label", sa.String(length=100), nullable=True))
    op.add_column("agents", sa.Column("agent_md_path", sa.String(length=255), nullable=True))
    op.add_column(
        "agents",
        sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "agents",
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
    )

    op.create_index("ix_agents_goal_category", "agents", ["goal_category"])
    op.create_index("ix_agents_interaction_mode", "agents", ["interaction_mode"])
    op.create_index("ix_agents_relationship_intent", "agents", ["relationship_intent"])
    op.create_index("ix_agents_location_geohash5", "agents", ["location_geohash5"])
    op.create_index(
        "ix_agents_compatible_intents_gin",
        "agents",
        ["compatible_intents"],
        postgresql_using="gin",
    )
    op.create_index(
        "ix_agents_topics_of_interest_gin",
        "agents",
        ["topics_of_interest"],
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_index("ix_agents_topics_of_interest_gin", table_name="agents")
    op.drop_index("ix_agents_compatible_intents_gin", table_name="agents")
    op.drop_index("ix_agents_location_geohash5", table_name="agents")
    op.drop_index("ix_agents_relationship_intent", table_name="agents")
    op.drop_index("ix_agents_interaction_mode", table_name="agents")
    op.drop_index("ix_agents_goal_category", table_name="agents")

    op.drop_column("agents", "revision")
    op.drop_column("agents", "schema_version")
    op.drop_column("agents", "agent_md_path")
    op.drop_column("agents", "location_label")
    op.drop_column("agents", "location_geohash5")
    op.drop_column("agents", "llm_settings")
    op.drop_column("agents", "availability")
    op.drop_column("agents", "safety")
    op.drop_column("agents", "escalation_policy")
    op.drop_column("agents", "conversation_phases")
    op.drop_column("agents", "boundaries")
    op.drop_column("agents", "topics_of_interest")
    op.drop_column("agents", "compatible_intents")
    op.drop_column("agents", "relationship_intent")
    op.drop_column("agents", "interaction_mode")
    op.drop_column("agents", "goal_category")
    op.drop_column("agents", "goal")
    op.drop_column("agents", "slug")
