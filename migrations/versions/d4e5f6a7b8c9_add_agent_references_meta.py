"""add agent references metadata column

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-05-03

PR-5: Stores references metadata (name, description, load_when, priority,
max_chars) so workers can resolve which references to load on escalation
without reading any .md frontmatter on the hot path.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d4e5f6a7b8c9"
down_revision: str | Sequence[str] | None = "c3d4e5f6a7b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agents",
        sa.Column("references_meta", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agents", "references_meta")
