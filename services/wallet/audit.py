"""Pure ledger-invariant checks backing GET /audit/ledger.

Every function operates on plain values (no session, no I/O) so the
invariants are unit-testable without a database.
"""
from typing import Protocol
from uuid import UUID

from shared.crypto import build_tx_data, verify_signature


class LedgerRow(Protocol):
    tx_id: UUID
    account_id: UUID
    amount: int
    currency: str
    tx_type: str
    signature: bytes | None


def check_tx_group(entries: list[LedgerRow]) -> list[str]:
    """Validate the double-entry invariants for one transaction's entries."""
    if len(entries) != 2:
        return [f"expected 2 entries, found {len(entries)}"]
    a, b = entries
    problems: list[str] = []
    if a.amount + b.amount != 0:
        problems.append(f"amounts do not sum to zero ({a.amount} + {b.amount})")
    if not (min(a.amount, b.amount) < 0 < max(a.amount, b.amount)):
        problems.append("expected one debit and one credit")
    if a.currency != b.currency:
        problems.append(f"currency mismatch ({a.currency} vs {b.currency})")
    if a.tx_type != b.tx_type:
        problems.append(f"tx_type mismatch ({a.tx_type} vs {b.tx_type})")
    if a.signature != b.signature:
        problems.append("signature mismatch between debit and credit")
    return problems


def verify_tx_signature(
    tx_id: UUID,
    entries: list[LedgerRow],
    pubkey_by_wallet: dict[UUID, bytes],
) -> bool:
    """Rebuild tx_data from the debit/credit pair and verify the signature.

    The debit-side wallet is the signer on both write paths (transfer signs
    with the sender, genesis signs with the system wallet).
    """
    debit = next((e for e in entries if e.amount < 0), None)
    credit = next((e for e in entries if e.amount > 0), None)
    if debit is None or credit is None or debit.signature is None:
        return False
    public_key = pubkey_by_wallet.get(debit.account_id)
    if public_key is None:
        return False
    tx_data = build_tx_data(
        str(tx_id), str(debit.account_id), str(credit.account_id),
        credit.amount, credit.currency, credit.tx_type,
    )
    return verify_signature(public_key, tx_data, debit.signature)


def check_balances(
    materialized: dict[UUID, int],
    summed: dict[UUID, int],
    system_wallet_id: UUID | None,
) -> list[str]:
    """Compare materialized wallet balances against ledger sums."""
    problems: list[str] = []
    for wallet_id, balance in materialized.items():
        ledger_sum = summed.get(wallet_id, 0)
        if balance != ledger_sum:
            problems.append(
                f"wallet {wallet_id}: balance {balance} != ledger sum {ledger_sum}"
            )
        if balance < 0 and wallet_id != system_wallet_id:
            problems.append(f"wallet {wallet_id}: negative balance {balance}")
    total = sum(summed.values())
    if total != 0:
        problems.append(f"global ledger sum is {total}, expected 0")
    return problems
