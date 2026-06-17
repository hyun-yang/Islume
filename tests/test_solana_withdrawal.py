"""Solana withdrawal: task serialization, schema contract, address validation.

DB-free / network-free unit tests — they exercise the pure pieces of the
withdrawal path. The debit→escrow→enqueue flow and the mint worker state machine
are covered by the live end-to-end run (docs/JOURNAL.md), not here.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from services.wallet.schemas import WithdrawalRequest, WithdrawalResponse
from shared.messages import WithdrawalTask
from shared.solana import is_valid_solana_address

ALICE = UUID("00000001-0000-0000-0000-000000000000")
# A real, well-formed Solana pubkey (base58, decodes to 32 bytes).
VALID_ADDR = "AGdEifwBYEaB8Dvwyja7nBqpDZBVDPbH8tQNDASLWdsX"


def test_withdrawal_task_round_trips():
    wid = uuid4()
    task = WithdrawalTask(withdrawal_id=wid)
    restored = WithdrawalTask.from_redis(task.to_redis())
    assert restored.withdrawal_id == wid


def test_withdrawal_task_to_redis_is_flat_strings():
    task = WithdrawalTask(withdrawal_id=uuid4())
    redis_dict = task.to_redis()
    assert all(isinstance(k, str) and isinstance(v, str) for k, v in redis_dict.items())


def _request(**overrides) -> WithdrawalRequest:
    payload = {
        "from_user_id": str(ALICE),
        "amount": 100,
        "destination_address": VALID_ADDR,
        **overrides,
    }
    return WithdrawalRequest(**payload)


def test_withdrawal_request_key_optional():
    assert _request().idempotency_key is None


def test_withdrawal_request_rejects_nonpositive_amount():
    with pytest.raises(ValidationError):
        _request(amount=0)


def test_withdrawal_request_rejects_short_address():
    with pytest.raises(ValidationError):
        _request(destination_address="too-short")


def test_withdrawal_request_rejects_oversized_key():
    with pytest.raises(ValidationError):
        _request(idempotency_key="x" * 129)


def test_withdrawal_response_replay_defaults_false():
    response = WithdrawalResponse(
        withdrawal_id=uuid4(),
        user_id=ALICE,
        amount=100,
        destination_address=VALID_ADDR,
        status="pending",
        created_at="2026-06-17T00:00:00",
    )
    assert response.idempotent_replay is False


def test_valid_solana_address_accepts_real_pubkey():
    assert is_valid_solana_address(VALID_ADDR) is True


@pytest.mark.parametrize(
    "bad",
    ["", "not-a-real-address", "0OIl" * 11, "z" * 50],  # 0/O/I/l not base58; too long
)
def test_valid_solana_address_rejects_garbage(bad):
    assert is_valid_solana_address(bad) is False
