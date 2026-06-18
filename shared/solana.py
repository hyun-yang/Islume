"""Solana SPL-token client — the single on-chain entry point.

Mirrors get_redis()/get_sessionmaker(): module-level cached singletons so every
caller in a process shares one RPC connection. Hybrid model — the Postgres
ledger is the source of truth; SPL tokens are minted on-chain only on withdrawal.

Devnet, gasless mint: the mint authority is ALSO the fee payer and pays the
recipient's associated-token-account (ATA) rent, so the recipient needs no SOL.
decimals=0, so an ISL amount maps 1:1 to base units (no scaling).

This is the ONLY place that talks to Solana — adding a caller inherits the
client/keypair handling, the same way shared/llm.py is the single LLM point.
"""
from __future__ import annotations

import asyncio
from functools import lru_cache

from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Commitment
from solana.rpc.types import TxOpts
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.signature import Signature
from spl.token.async_client import AsyncToken
from spl.token.constants import TOKEN_PROGRAM_ID
from spl.token.instructions import get_associated_token_address

from shared.config import get_settings


@lru_cache(maxsize=1)
def get_solana_client() -> AsyncClient:
    s = get_settings()
    return AsyncClient(
        endpoint=s.solana_rpc_url,
        commitment=Commitment(s.solana_commitment),
        timeout=s.solana_rpc_timeout,
    )


@lru_cache(maxsize=1)
def _authority_keypair() -> Keypair:
    """Load the mint-authority keypair (also fee payer). Accepts a 64-byte hex
    secret (128 hex chars, matches WALLET_MASTER_KEY style) or a base58 string
    (Phantom / solana-keygen export)."""
    secret = get_settings().solana_mint_authority_secret
    if not secret:
        raise RuntimeError("SOLANA_MINT_AUTHORITY_SECRET is not set")
    if len(secret) == 128:
        return Keypair.from_bytes(bytes.fromhex(secret))
    return Keypair.from_base58_string(secret)


@lru_cache(maxsize=1)
def _mint_pubkey() -> Pubkey:
    mint = get_settings().solana_isl_mint
    if not mint:
        raise RuntimeError("SOLANA_ISL_MINT is not set")
    return Pubkey.from_string(mint)


def is_valid_solana_address(address: str) -> bool:
    """Cheap synchronous validation for the HTTP path — no RPC, no keypair."""
    try:
        Pubkey.from_string(address)
        return True
    except Exception:
        return False


def solana_address_from_pubkey(public_key: bytes) -> str:
    """Base58 Solana address for a wallet's 32-byte Ed25519 public key.

    A custodial wallet's `public_key` IS a valid Solana account address: a Solana
    pubkey is just the base58 encoding of a 32-byte Ed25519 public key — the same
    curve shared/crypto.py already generates. So every existing wallet has a
    receive-capable on-chain address with no new key material; we derive it on
    read (no storage, no backfill).

    Length is checked here so a malformed key raises a clean ValueError instead
    of letting Pubkey.from_bytes panic in Rust (pyo3 PanicException) on the HTTP
    request path.
    """
    if len(public_key) != 32:
        raise ValueError(f"Ed25519 public key must be 32 bytes, got {len(public_key)}")
    return str(Pubkey.from_bytes(public_key))


async def mint_isl_to(destination_address: str, amount: int) -> str:
    """Submit an SPL mint of `amount` ISL to an external address. Ensures the
    recipient's ATA exists (fee payer = authority), then mints. Does NOT wait
    for confirmation — returns the submitted transaction signature so the worker
    can persist it BEFORE confirming (see services/worker/solana_mint.py).

    Raises on RPC/keypair/address errors; the caller leaves the task in the PEL.
    """
    s = get_settings()
    assert s.solana_decimals == 0, "decimals must be 0 for 1:1 ISL mapping"
    conn = get_solana_client()
    authority = _authority_keypair()
    mint = _mint_pubkey()
    owner = Pubkey.from_string(destination_address)  # raises on malformed input

    token = AsyncToken(conn, mint, TOKEN_PROGRAM_ID, authority)
    ata = get_associated_token_address(owner, mint)
    info = await conn.get_account_info(ata)
    if info.value is None:
        # Idempotent in practice: pre-check + create-only-when-missing. If a
        # concurrent create won the race, the RPC errors "already in use" —
        # swallow it and proceed to mint into the now-existing ATA.
        try:
            await token.create_associated_token_account(owner)
        except Exception as e:  # noqa: BLE001 — re-check rather than trust the message
            recheck = await conn.get_account_info(ata)
            if recheck.value is None:
                raise RuntimeError(f"ATA creation failed for {owner}: {e}") from e

    resp = await token.mint_to(
        dest=ata,
        mint_authority=authority,
        amount=amount,  # decimals=0 → 1 ISL == 1 base unit
        opts=TxOpts(skip_confirmation=True, preflight_commitment=conn.commitment),
    )
    return str(resp.value)


async def confirm_mint(signature: str) -> tuple[bool, str | None]:
    """Wait (bounded by solana_confirm_timeout) for a submitted mint to confirm.
    Returns (True, None) on success, (False, reason) on failure/timeout."""
    s = get_settings()
    conn = get_solana_client()
    sig = Signature.from_string(signature)
    try:
        resp = await asyncio.wait_for(
            conn.confirm_transaction(sig, commitment=Commitment(s.solana_commitment)),
            timeout=s.solana_confirm_timeout,
        )
    except TimeoutError:
        return False, "confirm_timeout"
    status = resp.value[0] if resp.value else None
    if status is None:
        return False, "not_found"
    if status.err is not None:
        return False, str(status.err)
    return True, None


async def signature_status(signature: str) -> str | None:
    """Single-shot status for reclaim reconciliation. Returns 'confirmed' if the
    tx landed without error, 'failed' if it landed with an error, or None if the
    RPC has no record of it (dropped / never landed → safe to resubmit)."""
    conn = get_solana_client()
    sig = Signature.from_string(signature)
    resp = await conn.get_signature_statuses([sig], search_transaction_history=True)
    status = resp.value[0] if resp.value else None
    if status is None:
        return None
    if status.err is not None:
        return "failed"
    return "confirmed"
