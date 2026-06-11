"""harden wallet/ledger: materialized balance + integrity constraints

Revision ID: 0621ff77aa88
Revises: 0620ab77cd88
Create Date: 2026-06-11

ISL transaction hardening:
- wallets.balance: materialized balance column (backfilled from ledger SUM),
  updated in the same transaction as ledger inserts. The ledger stays the
  source of truth; the column makes reads O(1) and enables the DB-level
  overdraft CHECK below.
- ck_wallets_balance_non_negative: overdraft is impossible even if app logic
  regresses. The system wallet (all-zeros user) is the treasury and may go
  negative; IS NOT DISTINCT FROM keeps a NULL user_id from bypassing the CHECK.
- uq_ledger_entries_tx_account: one entry per (tx_id, account) — both the
  double-entry invariant and the idempotency guard (tx_id is uuid5-derived
  from the client's idempotency key). Replaces the plain ix_ledger_entries_tx_id
  index (the unique index's leading column serves the same lookups).
- amount <> 0 and currency = 'ISL' CHECKs.

If a dev DB contains historical duplicate (tx_id, account_id) rows from past
double-spends, the unique constraint step fails — do the full reseed
(docker compose down -v flow). Local dev only; no prod data exists yet.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0621ff77aa88"
down_revision: str | Sequence[str] | None = "0620ab77cd88"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "wallets",
        sa.Column("balance", sa.BigInteger(), nullable=False, server_default="0"),
    )
    op.execute(
        "UPDATE wallets SET balance = COALESCE("
        "(SELECT SUM(amount) FROM ledger_entries"
        " WHERE ledger_entries.account_id = wallets.id), 0)"
    )
    op.create_check_constraint(
        "ck_wallets_balance_non_negative",
        "wallets",
        "balance >= 0 OR user_id IS NOT DISTINCT FROM"
        " '00000000-0000-0000-0000-000000000000'::uuid",
    )
    op.create_check_constraint(
        "ck_ledger_entries_amount_nonzero", "ledger_entries", "amount <> 0"
    )
    op.create_check_constraint(
        "ck_ledger_entries_currency_isl", "ledger_entries", "currency = 'ISL'"
    )
    op.create_unique_constraint(
        "uq_ledger_entries_tx_account", "ledger_entries", ["tx_id", "account_id"]
    )
    op.drop_index("ix_ledger_entries_tx_id", table_name="ledger_entries")


def downgrade() -> None:
    op.create_index("ix_ledger_entries_tx_id", "ledger_entries", ["tx_id"])
    op.drop_constraint(
        "uq_ledger_entries_tx_account", "ledger_entries", type_="unique"
    )
    op.drop_constraint(
        "ck_ledger_entries_currency_isl", "ledger_entries", type_="check"
    )
    op.drop_constraint(
        "ck_ledger_entries_amount_nonzero", "ledger_entries", type_="check"
    )
    op.drop_constraint("ck_wallets_balance_non_negative", "wallets", type_="check")
    op.drop_column("wallets", "balance")
