"""widen match_sessions.status to varchar(30)

Revision ID: 0619ee55ff66
Revises: 0618cc33dd44
Create Date: 2026-06-10

The worker sets status="awaiting_owner_confirmation" (27 chars) when a plugin
tool call needs owner approval, but the column was created as VARCHAR(20) —
the commit raises StringDataRightTruncationError and the pending-approval
flow dies. Widen to 30.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0619ee55ff66"
down_revision: str | Sequence[str] | None = "0618cc33dd44"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "match_sessions",
        "status",
        existing_type=sa.String(length=20),
        type_=sa.String(length=30),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "match_sessions",
        "status",
        existing_type=sa.String(length=30),
        type_=sa.String(length=20),
        existing_nullable=False,
    )
