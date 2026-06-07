"""add island_voxel_maps and island_map_edits tables

Revision ID: a1b2c3d4e5f6
Revises: 77b773951fb1
Create Date: 2026-04-20 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "77b773951fb1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "island_voxel_maps",
        sa.Column("id", postgresql.UUID(), nullable=False),
        sa.Column("island_id", postgresql.UUID(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("voxel_data", sa.LargeBinary(), nullable=False),
        sa.Column("heightmap", sa.LargeBinary(), nullable=True),
        sa.Column("block_palette", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["island_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("island_id"),
    )

    op.create_table(
        "island_map_edits",
        sa.Column("id", postgresql.UUID(), nullable=False),
        sa.Column("island_id", postgresql.UUID(), nullable=False),
        sa.Column("editor_id", postgresql.UUID(), nullable=False),
        sa.Column("changes", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["island_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["editor_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("island_map_edits")
    op.drop_table("island_voxel_maps")
