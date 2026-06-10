"""add partner_evaluations table

Revision ID: 0618cc33dd44
Revises: 0617aa11bb22
Create Date: 2026-06-10

Adds partner_evaluations — per-agent, owner-private evaluations of the
conversation partner, produced at the max_turns checkpoint and at session
end. Category-specific verdicts live in JSONB; the shared
match_sessions.affinity_* columns remain the owner-agnostic score mirror.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0618cc33dd44"
down_revision: str | Sequence[str] | None = "0617aa11bb22"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "partner_evaluations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("match_sessions.id"),
            nullable=False,
        ),
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
        sa.Column(
            "evaluated_agent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("agents.id"),
            nullable=False,
        ),
        sa.Column("goal_category", sa.String(length=30), nullable=True),
        sa.Column("template", sa.String(length=20), nullable=False),
        sa.Column("verdicts", postgresql.JSONB(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("turn_number", sa.Integer(), nullable=False),
        sa.Column("trigger", sa.String(length=20), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_partner_evaluations_user_created",
        "partner_evaluations",
        ["user_id", "created_at"],
    )
    op.create_index(
        "ix_partner_evaluations_session_agent",
        "partner_evaluations",
        ["session_id", "agent_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_partner_evaluations_session_agent", table_name="partner_evaluations"
    )
    op.drop_index(
        "ix_partner_evaluations_user_created", table_name="partner_evaluations"
    )
    op.drop_table("partner_evaluations")
