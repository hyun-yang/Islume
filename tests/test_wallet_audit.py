"""Pure ledger-invariant checkers behind GET /audit/ledger."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID, uuid4

import nacl.signing

from services.wallet.audit import check_balances, check_tx_group, verify_tx_signature
from shared.crypto import build_tx_data

SYSTEM_WALLET = UUID("00000100-0000-0000-0000-000000000000")
WALLET_A = UUID("00000201-0000-0000-0000-000000000000")
WALLET_B = UUID("00000202-0000-0000-0000-000000000000")


@dataclass
class Row:
    tx_id: UUID
    account_id: UUID
    amount: int
    currency: str = "ISL"
    tx_type: str = "tip"
    signature: bytes | None = None


def _pair(amount: int = 10, **overrides) -> list[Row]:
    tx_id = overrides.pop("tx_id", uuid4())
    debit = Row(tx_id=tx_id, account_id=WALLET_A, amount=-amount)
    credit = Row(tx_id=tx_id, account_id=WALLET_B, amount=amount)
    for key, value in overrides.items():
        setattr(credit, key, value)
    return [debit, credit]


# ---- check_tx_group --------------------------------------------------------


def test_good_pair_has_no_problems():
    assert check_tx_group(_pair()) == []


def test_wrong_entry_count():
    entries = _pair()
    assert "expected 2 entries" in check_tx_group(entries[:1])[0]
    assert "expected 2 entries" in check_tx_group(entries + [entries[0]])[0]


def test_nonzero_sum_detected():
    entries = _pair()
    entries[1].amount += 1
    assert any("sum to zero" in p for p in check_tx_group(entries))


def test_missing_debit_credit_split():
    tx_id = uuid4()
    entries = [
        Row(tx_id=tx_id, account_id=WALLET_A, amount=0),
        Row(tx_id=tx_id, account_id=WALLET_B, amount=0),
    ]
    assert any("one debit and one credit" in p for p in check_tx_group(entries))


def test_currency_mismatch_detected():
    assert any("currency" in p for p in check_tx_group(_pair(currency="USD")))


def test_tx_type_mismatch_detected():
    assert any("tx_type" in p for p in check_tx_group(_pair(tx_type="rps_bet")))


def test_signature_mismatch_detected():
    assert any("signature" in p for p in check_tx_group(_pair(signature=b"other")))


# ---- verify_tx_signature ---------------------------------------------------


def _signed_pair() -> tuple[list[Row], dict[UUID, bytes]]:
    signing_key = nacl.signing.SigningKey.generate()
    public_key = bytes(signing_key.verify_key)
    tx_id = uuid4()
    tx_data = build_tx_data(
        str(tx_id), str(WALLET_A), str(WALLET_B), 10, "ISL", "tip"
    )
    signature = signing_key.sign(tx_data).signature
    entries = [
        Row(tx_id=tx_id, account_id=WALLET_A, amount=-10, signature=signature),
        Row(tx_id=tx_id, account_id=WALLET_B, amount=10, signature=signature),
    ]
    return entries, {WALLET_A: public_key}


def test_valid_signature_verifies():
    entries, pubkeys = _signed_pair()
    assert verify_tx_signature(entries[0].tx_id, entries, pubkeys) is True


def test_tampered_amount_fails_verification():
    entries, pubkeys = _signed_pair()
    entries[0].amount, entries[1].amount = -11, 11
    assert verify_tx_signature(entries[0].tx_id, entries, pubkeys) is False


def test_unknown_debit_wallet_fails():
    entries, _ = _signed_pair()
    assert verify_tx_signature(entries[0].tx_id, entries, {}) is False


def test_missing_signature_fails():
    entries, pubkeys = _signed_pair()
    entries[0].signature = None
    assert verify_tx_signature(entries[0].tx_id, entries, pubkeys) is False


# ---- check_balances --------------------------------------------------------


def test_matching_balances_ok():
    materialized = {SYSTEM_WALLET: -10, WALLET_A: 10}
    summed = {SYSTEM_WALLET: -10, WALLET_A: 10}
    assert check_balances(materialized, summed, SYSTEM_WALLET) == []


def test_balance_drift_detected():
    materialized = {WALLET_A: 11}
    summed = {WALLET_A: 10, SYSTEM_WALLET: -10}
    problems = check_balances(materialized, summed, SYSTEM_WALLET)
    assert any("!= ledger sum" in p for p in problems)


def test_negative_user_balance_detected():
    materialized = {WALLET_A: -5, SYSTEM_WALLET: 5}
    summed = {WALLET_A: -5, SYSTEM_WALLET: 5}
    problems = check_balances(materialized, summed, SYSTEM_WALLET)
    assert any("negative balance" in p for p in problems)


def test_negative_system_balance_allowed():
    materialized = {SYSTEM_WALLET: -10, WALLET_A: 10}
    summed = {SYSTEM_WALLET: -10, WALLET_A: 10}
    assert check_balances(materialized, summed, SYSTEM_WALLET) == []


def test_global_sum_imbalance_detected():
    materialized = {WALLET_A: 10}
    summed = {WALLET_A: 10}
    problems = check_balances(materialized, summed, SYSTEM_WALLET)
    assert any("global ledger sum" in p for p in problems)


def test_wallet_missing_from_ledger_uses_zero():
    problems = check_balances({WALLET_A: 5}, {}, SYSTEM_WALLET)
    assert any("balance 5 != ledger sum 0" in p for p in problems)
