"""Solana address derivation from a wallet's Ed25519 public key.

A custodial wallet's `public_key` IS a Solana account address. These DB-free /
config-free unit tests pin that derivation (base58 of the 32-byte Ed25519 key)
so the WalletPanel address and any future deposit lookup stay consistent. The
keys are produced with raw nacl — same primitive as shared/crypto.py — so no
WALLET_MASTER_KEY is needed here.
"""

from __future__ import annotations

import nacl.signing
import pytest
from solders.pubkey import Pubkey

from shared.solana import is_valid_solana_address, solana_address_from_pubkey


def _pubkey() -> bytes:
    """A fresh 32-byte Ed25519 public key, exactly as generate_keypair() makes."""
    return bytes(nacl.signing.SigningKey.generate().verify_key)


def test_derived_address_is_valid_solana_address():
    assert is_valid_solana_address(solana_address_from_pubkey(_pubkey()))


def test_derived_address_round_trips_to_public_key():
    pk = _pubkey()
    addr = solana_address_from_pubkey(pk)
    assert bytes(Pubkey.from_string(addr)) == pk


def test_derivation_is_deterministic():
    pk = _pubkey()
    assert solana_address_from_pubkey(pk) == solana_address_from_pubkey(pk)


def test_distinct_keys_give_distinct_addresses():
    assert solana_address_from_pubkey(_pubkey()) != solana_address_from_pubkey(_pubkey())


def test_all_zero_key_is_canonical_system_program_address():
    # base58 of 32 zero bytes is the well-known all-ones System Program address.
    assert solana_address_from_pubkey(bytes(32)) == "11111111111111111111111111111111"


def test_rejects_wrong_length_pubkey():
    with pytest.raises(ValueError):
        solana_address_from_pubkey(bytes(31))
