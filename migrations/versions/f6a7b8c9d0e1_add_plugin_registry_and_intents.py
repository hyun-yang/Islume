"""add plugin registry columns and intent_* tables

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-05-22

Adds:
- agents.attached_plugins (JSONB, nullable)
- match_sessions.deal_status (VARCHAR, nullable), shared_references (JSONB, nullable)
- conversation_turns.tool_calls (JSONB, nullable)
- intent_proposals, intent_agreements, tool_call_events (3 new tables)

All additions are nullable and non-destructive. Existing agents/sessions/turns continue to work
unchanged when no plugin is attached.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f6a7b8c9d0e1"
down_revision: str | Sequence[str] | None = "e5f6a7b8c9d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ---- agents -----------------------------------------------------------
    op.add_column(
        "agents",
        sa.Column("attached_plugins", postgresql.JSONB(), nullable=True),
    )

    # ---- match_sessions ---------------------------------------------------
    op.add_column(
        "match_sessions",
        sa.Column("deal_status", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "match_sessions",
        sa.Column("shared_references", postgresql.JSONB(), nullable=True),
    )

    # ---- conversation_turns ----------------------------------------------
    op.add_column(
        "conversation_turns",
        sa.Column("tool_calls", postgresql.JSONB(), nullable=True),
    )

    # ---- intent_proposals -------------------------------------------------
    op.create_table(
        "intent_proposals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("match_sessions.id"),
            nullable=False,
        ),
        sa.Column(
            "proposer_agent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("agents.id"),
            nullable=False,
        ),
        sa.Column("turn_number", sa.Integer(), nullable=False),
        sa.Column("plugin", sa.String(length=50), nullable=False),
        sa.Column("proposal_type", sa.String(length=30), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default="open",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_intent_proposals_session_created",
        "intent_proposals",
        ["session_id", "created_at"],
    )
    op.create_index(
        "ix_intent_proposals_session_status",
        "intent_proposals",
        ["session_id", "status"],
    )

    # ---- intent_agreements -----------------------------------------------
    op.create_table(
        "intent_agreements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("match_sessions.id"),
            nullable=False,
        ),
        sa.Column(
            "proposal_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("intent_proposals.id"),
            nullable=False,
        ),
        sa.Column(
            "accepting_agent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("agents.id"),
            nullable=False,
        ),
        sa.Column(
            "finalized",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_intent_agreements_session_created",
        "intent_agreements",
        ["session_id", "created_at"],
    )

    # ---- tool_call_events ------------------------------------------------
    op.create_table(
        "tool_call_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("match_sessions.id"),
            nullable=False,
        ),
        sa.Column("turn_number", sa.Integer(), nullable=False),
        sa.Column(
            "agent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("agents.id"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("plugin", sa.String(length=50), nullable=False),
        sa.Column("tool_name", sa.String(length=60), nullable=False),
        sa.Column("arguments", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("policy_reason", sa.Text(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_tool_call_events_session_created",
        "tool_call_events",
        ["session_id", "created_at"],
    )
    op.create_index(
        "ix_tool_call_events_user_status",
        "tool_call_events",
        ["user_id", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_tool_call_events_user_status", table_name="tool_call_events")
    op.drop_index("ix_tool_call_events_session_created", table_name="tool_call_events")
    op.drop_table("tool_call_events")

    op.drop_index(
        "ix_intent_agreements_session_created", table_name="intent_agreements"
    )
    op.drop_table("intent_agreements")

    op.drop_index("ix_intent_proposals_session_status", table_name="intent_proposals")
    op.drop_index("ix_intent_proposals_session_created", table_name="intent_proposals")
    op.drop_table("intent_proposals")

    op.drop_column("conversation_turns", "tool_calls")
    op.drop_column("match_sessions", "shared_references")
    op.drop_column("match_sessions", "deal_status")
    op.drop_column("agents", "attached_plugins")
