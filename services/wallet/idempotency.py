"""Deterministic tx_id derivation for idempotent transfers.

A client-supplied idempotency key maps to a stable tx_id via uuid5, so a
retried request produces the same tx_id and trips the
uq_ledger_entries_tx_account constraint instead of double-spending.
"""
from uuid import UUID, uuid5

# Fixed namespace — changing it would re-derive every keyed tx_id and break
# replay detection for in-flight retries.
WALLET_TX_NAMESPACE = UUID("a2c1e7f0-5b3d-4e8a-9c6f-1d2b3a4c5e6f")


def derive_tx_id(from_user_id: UUID, idempotency_key: str) -> UUID:
    # Scoped per sender so two users reusing the same key string never collide.
    return uuid5(WALLET_TX_NAMESPACE, f"{from_user_id}:{idempotency_key}")
