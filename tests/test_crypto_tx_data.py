"""Canonical tx_data format freeze + sign/verify round trip."""

from __future__ import annotations

import nacl.signing
import nacl.utils
import pytest

from shared.crypto import (
    build_tx_data,
    generate_keypair,
    sign_transaction,
    verify_signature,
)

# FROZEN: every ledger signature ever stored was computed over this exact
# byte layout (sorted keys, json.dumps default separators). If this test
# fails, the change to build_tx_data invalidated all stored signatures —
# revert it.
GOLDEN_BYTES = (
    b'{"amount": 42, "currency": "ISL", "from": "wallet-a", '
    b'"to": "wallet-b", "tx_id": "tx-1", "tx_type": "tip"}'
)


def test_tx_data_golden_bytes():
    assert build_tx_data("tx-1", "wallet-a", "wallet-b", 42, "ISL", "tip") == GOLDEN_BYTES


@pytest.fixture
def master_key(monkeypatch):
    key_hex = nacl.utils.random(32).hex()

    class _Settings:
        wallet_master_key = key_hex

    monkeypatch.setattr("shared.crypto.get_settings", lambda: _Settings())
    return key_hex


def test_sign_verify_round_trip(master_key):
    public_key, encrypted_private_key = generate_keypair()
    tx_data = build_tx_data("tx-1", "wallet-a", "wallet-b", 42, "ISL", "tip")
    signature = sign_transaction(encrypted_private_key, tx_data)
    assert verify_signature(public_key, tx_data, signature) is True


def test_verify_rejects_tampered_data(master_key):
    public_key, encrypted_private_key = generate_keypair()
    tx_data = build_tx_data("tx-1", "wallet-a", "wallet-b", 42, "ISL", "tip")
    signature = sign_transaction(encrypted_private_key, tx_data)
    tampered = build_tx_data("tx-1", "wallet-a", "wallet-b", 43, "ISL", "tip")
    assert verify_signature(public_key, tampered, signature) is False


def test_verify_rejects_wrong_key(master_key):
    _, encrypted_private_key = generate_keypair()
    other_public = bytes(nacl.signing.SigningKey.generate().verify_key)
    tx_data = build_tx_data("tx-1", "wallet-a", "wallet-b", 42, "ISL", "tip")
    signature = sign_transaction(encrypted_private_key, tx_data)
    assert verify_signature(other_public, tx_data, signature) is False
