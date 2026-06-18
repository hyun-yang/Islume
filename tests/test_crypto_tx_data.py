"""Canonical tx_data format freeze + sign/verify round trip."""

from __future__ import annotations

from uuid import UUID

import nacl.signing
import nacl.utils
import pytest

from shared.crypto import (
    build_tx_data,
    decrypt_private_key,
    derive_keypair,
    generate_keypair,
    sign_transaction,
    verify_signature,
)
from shared.solana import is_valid_solana_address, solana_address_from_pubkey

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


# --- Deterministic keypair derivation (stable per-user Solana address) --------

ALICE = UUID("00000001-0000-0000-0000-000000000000")
BOB = UUID("00000002-0000-0000-0000-000000000000")


def test_derive_keypair_is_deterministic(master_key):
    # The PUBLIC key (hence the Solana address) is identical every call — this is
    # what makes a user's address survive DB wipes / re-seeds. The encrypted
    # private blob differs each call (SecretBox uses a random nonce) but decrypts
    # to the same key, so the identity is stable.
    pub1, enc1 = derive_keypair(ALICE)
    pub2, enc2 = derive_keypair(ALICE)
    assert pub1 == pub2
    assert decrypt_private_key(enc1) == decrypt_private_key(enc2)


def test_derive_keypair_distinct_per_user(master_key):
    assert derive_keypair(ALICE)[0] != derive_keypair(BOB)[0]


def test_derived_keypair_gives_stable_valid_solana_address(master_key):
    addr1 = solana_address_from_pubkey(derive_keypair(ALICE)[0])
    addr2 = solana_address_from_pubkey(derive_keypair(ALICE)[0])
    assert addr1 == addr2
    assert is_valid_solana_address(addr1)


def test_derived_private_key_signs_and_verifies(master_key):
    # The derived encrypted private key still produces valid ledger signatures.
    public_key, encrypted_private_key = derive_keypair(ALICE)
    tx_data = build_tx_data("tx-1", "wallet-a", "wallet-b", 42, "ISL", "tip")
    signature = sign_transaction(encrypted_private_key, tx_data)
    assert verify_signature(public_key, tx_data, signature) is True


def test_derive_keypair_depends_on_master_key(monkeypatch):
    # Different master key -> different derived key (the secret actually gates it,
    # so a public UUID alone can't reproduce the address).
    def _use_key(key_hex):
        class _Settings:
            wallet_master_key = key_hex

        monkeypatch.setattr("shared.crypto.get_settings", lambda: _Settings())

    _use_key(nacl.utils.random(32).hex())
    first = derive_keypair(ALICE)[0]
    _use_key(nacl.utils.random(32).hex())
    second = derive_keypair(ALICE)[0]
    assert first != second
