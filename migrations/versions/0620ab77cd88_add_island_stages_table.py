"""add island_stages table

Revision ID: 0620ab77cd88
Revises: 0619ee55ff66
Create Date: 2026-06-10

User-authored platformer stages (Mario Maker style). Each island (user)
owns up to 3 stages addressed by slot 1..3 — the unique (island_id, slot)
index is what enforces the max-3 cap structurally. Visitors only ever see
status='published' rows; publish requires cleared=true (enforced by the
visit API transitions, see services/visit/api.py).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0620ab77cd88"
down_revision: str | Sequence[str] | None = "0619ee55ff66"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "island_stages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "island_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("slot", sa.Integer(), nullable=False),
        sa.Column(
            "status", sa.String(length=16), nullable=False, server_default="draft"
        ),
        sa.Column(
            "cleared", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("level_data", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_island_stages_unique", "island_stages", ["island_id", "slot"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_island_stages_unique", table_name="island_stages")
    op.drop_table("island_stages")
