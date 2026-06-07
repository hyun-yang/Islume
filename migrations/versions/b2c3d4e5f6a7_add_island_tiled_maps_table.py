"""add island_tiled_maps table

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-04-20 14:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b2c3d4e5f6a7"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "island_tiled_maps",
        sa.Column("id", postgresql.UUID(), nullable=False),
        sa.Column("island_id", postgresql.UUID(), nullable=False),
        sa.Column("map_key", sa.String(64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("map_data", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["island_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_island_tiled_maps_unique",
        "island_tiled_maps",
        ["island_id", "map_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_island_tiled_maps_unique")
    op.drop_table("island_tiled_maps")
