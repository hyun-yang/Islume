"""Ed25519 keypair management and transaction signing for the ISL wallet."""
import json

import nacl.secret
import nacl.signing
from nacl.exceptions import BadSignatureError

from shared.config import get_settings


def _get_master_key() -> bytes:
    hex_key = get_settings().wallet_master_key
    if not hex_key:
        raise RuntimeError("WALLET_MASTER_KEY is not set")
    return bytes.fromhex(hex_key)


def generate_keypair() -> tuple[bytes, bytes]:
    signing_key = nacl.signing.SigningKey.generate()
    public_key = bytes(signing_key.verify_key)
    encrypted_private_key = encrypt_private_key(bytes(signing_key))
    return public_key, encrypted_private_key


def encrypt_private_key(raw: bytes) -> bytes:
    box = nacl.secret.SecretBox(_get_master_key())
    return bytes(box.encrypt(raw))


def decrypt_private_key(encrypted: bytes) -> bytes:
    box = nacl.secret.SecretBox(_get_master_key())
    return bytes(box.decrypt(encrypted))


def build_tx_data(
    tx_id: str,
    from_account: str,
    to_account: str,
    amount: int,
    currency: str,
    tx_type: str,
) -> bytes:
    """Canonical signing payload for a ledger transaction.

    FROZEN FORMAT: the exact byte output (key order, separators, encoding)
    is what every stored ledger signature was computed over. Changing it —
    even switching json.dumps separators — invalidates all existing
    signatures. The golden-bytes test in tests/test_crypto_tx_data.py
    guards this; if it fails, revert the change.
    """
    return json.dumps(
        {
            "amount": amount,
            "currency": currency,
            "from": from_account,
            "to": to_account,
            "tx_id": tx_id,
            "tx_type": tx_type,
        },
        sort_keys=True,
    ).encode()


def sign_transaction(encrypted_private_key: bytes, tx_data: bytes) -> bytes:
    raw_key = decrypt_private_key(encrypted_private_key)
    signing_key = nacl.signing.SigningKey(raw_key)
    signed = signing_key.sign(tx_data)
    return signed.signature


def verify_signature(public_key: bytes, tx_data: bytes, signature: bytes) -> bool:
    verify_key = nacl.signing.VerifyKey(public_key)
    try:
        verify_key.verify(tx_data, signature)
        return True
    except BadSignatureError:
        return False
