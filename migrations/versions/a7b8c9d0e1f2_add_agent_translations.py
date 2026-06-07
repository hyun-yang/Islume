"""add agent translations column

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-05-23

Per-locale overrides for user-facing persona content (name, description,
persona_prompt, tags). Nullable JSONB keyed by locale, e.g.
{"ko": {"name": ..., "persona_prompt": ...}}. Absent locales/fields fall back
to the base English columns. No backfill — existing agents stay English-only.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a7b8c9d0e1f2"
down_revision: str | Sequence[str] | None = "f6a7b8c9d0e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agents",
        sa.Column("translations", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agents", "translations")
