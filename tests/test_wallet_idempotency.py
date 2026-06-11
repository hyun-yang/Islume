"""Idempotent tx_id derivation and transfer schema contract."""

from __future__ import annotations

from uuid import UUID, uuid5

import pytest
from pydantic import ValidationError

from services.wallet.idempotency import WALLET_TX_NAMESPACE, derive_tx_id
from services.wallet.schemas import TransferRequest, TransferResponse

ALICE = UUID("00000001-0000-0000-0000-000000000000")
BOB = UUID("00000002-0000-0000-0000-000000000000")


def test_derive_is_deterministic():
    assert derive_tx_id(ALICE, "key-1") == derive_tx_id(ALICE, "key-1")


def test_derive_matches_uuid5_construction():
    assert derive_tx_id(ALICE, "key-1") == uuid5(
        WALLET_TX_NAMESPACE, f"{ALICE}:key-1"
    )


def test_derive_is_scoped_per_sender():
    assert derive_tx_id(ALICE, "shared-key") != derive_tx_id(BOB, "shared-key")


def test_derive_distinct_keys_distinct_ids():
    assert derive_tx_id(ALICE, "key-1") != derive_tx_id(ALICE, "key-2")


def _request(**overrides) -> TransferRequest:
    payload = {
        "from_user_id": str(ALICE),
        "to_user_id": str(BOB),
        "amount": 10,
        **overrides,
    }
    return TransferRequest(**payload)


def test_transfer_request_key_is_optional():
    assert _request().idempotency_key is None


def test_transfer_request_accepts_key():
    assert _request(idempotency_key="rps:abc").idempotency_key == "rps:abc"


def test_transfer_request_rejects_empty_key():
    with pytest.raises(ValidationError):
        _request(idempotency_key="")


def test_transfer_request_rejects_oversized_key():
    with pytest.raises(ValidationError):
        _request(idempotency_key="x" * 129)


def test_transfer_response_replay_defaults_false():
    response = TransferResponse(
        tx_id=derive_tx_id(ALICE, "key-1"),
        from_user_id=ALICE,
        to_user_id=BOB,
        amount=10,
        tx_type="tip",
        created_at="2026-06-11T00:00:00",
    )
    assert response.idempotent_replay is False
