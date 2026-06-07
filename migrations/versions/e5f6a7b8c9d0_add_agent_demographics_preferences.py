"""add agent demographics and preferences columns

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-05-03

Optional persona detail columns for the agent template feature:
demographics (height/sex/age/race/notes) and preferences (favorite
foods/movies/novels + life/religion/work views). Both nullable JSONB —
templates may populate them, users may leave them empty.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e5f6a7b8c9d0"
down_revision: str | Sequence[str] | None = "d4e5f6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agents",
        sa.Column("demographics", postgresql.JSONB(), nullable=True),
    )
    op.add_column(
        "agents",
        sa.Column("preferences", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agents", "preferences")
    op.drop_column("agents", "demographics")
