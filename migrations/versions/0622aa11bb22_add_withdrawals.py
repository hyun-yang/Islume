"""add withdrawals table + wallets.solana_address

Revision ID: 0622aa11bb22
Revises: 0621ff77aa88
Create Date: 2026-06-17

On-chain SPL withdrawal support (hybrid model). The withdrawals table tracks the
on-chain side of an ISL debit; the ISL move itself (user -> escrow) stays in
ledger_entries. The on-chain mint is NEVER recorded as a ledger entry — an
unpaired third entry would break /audit/ledger's double-entry checks.

The reserved escrow wallet row (user_id 00000000-...-0000000000e5) is seeded by
scripts/seed_db.py alongside the system wallet, NOT here — seeding a wallet needs
a generated keypair (WALLET_MASTER_KEY), which belongs in the seed script.

wallets.solana_address is a UX-only "last used address" cache (nullable, not
authoritative).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0622aa11bb22"
down_revision: str | Sequence[str] | None = "0621ff77aa88"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "wallets",
        sa.Column("solana_address", sa.String(length=64), nullable=True),
    )
    op.create_table(
        "withdrawals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "wallet_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("wallets.id"),
            nullable=False,
        ),
        sa.Column("ledger_tx_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("destination_address", sa.String(length=64), nullable=False),
        sa.Column(
            "status", sa.String(length=12), nullable=False, server_default="pending"
        ),
        sa.Column("solana_signature", sa.String(length=96), nullable=True),
        sa.Column("error", sa.String(length=512), nullable=True),
        sa.Column("attempts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending','minting','confirmed','failed')",
            name="ck_withdrawals_status",
        ),
        sa.CheckConstraint("amount > 0", name="ck_withdrawals_amount_positive"),
        sa.UniqueConstraint("ledger_tx_id", name="uq_withdrawals_ledger_tx_id"),
    )
    op.create_index(
        "ix_withdrawals_user_created", "withdrawals", ["user_id", "created_at"]
    )
    op.create_index("ix_withdrawals_status", "withdrawals", ["status"])


def downgrade() -> None:
    op.drop_index("ix_withdrawals_status", table_name="withdrawals")
    op.drop_index("ix_withdrawals_user_created", table_name="withdrawals")
    op.drop_table("withdrawals")
    op.drop_column("wallets", "solana_address")
