"""One-time: create the ISL SPL token mint on Devnet and fund the authority.

Typical flow:

    uv run python scripts/solana_create_mint.py

If the public Devnet faucet is up, this funds a fresh authority, creates the
mint, and prints the two values to paste into .env:

    SOLANA_ISL_MINT=<mint pubkey>
    SOLANA_MINT_AUTHORITY_SECRET=<64-byte hex secret>

If the faucet is rate-limited (429 / "Internal error" is common), the script
prints the authority pubkey + secret FIRST, then exits without a mint. To finish:
  1. copy the printed SOLANA_MINT_AUTHORITY_SECRET into .env
  2. fund the printed pubkey: https://faucet.solana.com  (or `solana airdrop 2 <pubkey> --url devnet`)
  3. re-run this script — it loads the authority from .env and creates the mint.

The mint authority is ALSO the fee payer (gasless mint for recipients). decimals=0
so 1 ISL maps 1:1 to a token base unit. Mint authority is kept (variable supply);
no freeze authority is set. One funded authority covers thousands of mints
(~0.002 SOL each).
"""
import asyncio

from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed
from solders.keypair import Keypair
from spl.token.async_client import AsyncToken
from spl.token.constants import TOKEN_PROGRAM_ID

from shared.config import get_settings

AIRDROP_LAMPORTS = 2_000_000_000  # 2 SOL
MIN_LAMPORTS = 5_000_000  # enough headroom for mint creation + a few ATAs


def _load_or_generate_authority(secret: str) -> tuple[Keypair, bool]:
    """Return (keypair, generated). Loads from the configured secret if present
    (hex-128 or base58), else generates a fresh one."""
    if secret:
        kp = (
            Keypair.from_bytes(bytes.fromhex(secret))
            if len(secret) == 128
            else Keypair.from_base58_string(secret)
        )
        return kp, False
    return Keypair(), True


async def main() -> None:
    settings = get_settings()
    conn = AsyncClient(
        settings.solana_rpc_url, commitment=Confirmed, timeout=settings.solana_rpc_timeout
    )
    authority, generated = _load_or_generate_authority(settings.solana_mint_authority_secret)

    print(f"RPC: {settings.solana_rpc_url}")
    print(f"Authority pubkey: {authority.pubkey()}")
    # Print the secret up front so a faucet failure doesn't lose it.
    print(f"SOLANA_MINT_AUTHORITY_SECRET={bytes(authority).hex()}")
    if generated:
        print("(generated a new authority — put the secret in .env)")

    balance = (await conn.get_balance(authority.pubkey())).value
    if balance < MIN_LAMPORTS:
        print(f"Balance {balance / 1e9:.4f} SOL — requesting airdrop...")
        try:
            airdrop = await conn.request_airdrop(authority.pubkey(), AIRDROP_LAMPORTS)
            await conn.confirm_transaction(airdrop.value, commitment=Confirmed)
            balance = (await conn.get_balance(authority.pubkey())).value
        except Exception as e:
            print(f"WARN: airdrop failed ({e}).")

    if balance < MIN_LAMPORTS:
        print("\nAuthority is not funded. Fund the pubkey above, then re-run:")
        print("  - put SOLANA_MINT_AUTHORITY_SECRET (above) into .env")
        print("  - fund via https://faucet.solana.com or `solana airdrop 2 <pubkey> --url devnet`")
        print("  - re-run: uv run python scripts/solana_create_mint.py")
        await conn.close()
        return

    print(f"Authority balance: {balance / 1e9:.4f} SOL — creating mint...")
    token = await AsyncToken.create_mint(
        conn,
        payer=authority,
        mint_authority=authority.pubkey(),
        decimals=0,  # 1 ISL == 1 base unit
        program_id=TOKEN_PROGRAM_ID,
        freeze_authority=None,  # variable supply, no freeze
    )
    await conn.close()

    print("\n=== Add these to .env ===")
    print(f"SOLANA_ISL_MINT={token.pubkey}")
    print(f"SOLANA_MINT_AUTHORITY_SECRET={bytes(authority).hex()}")
    print("=========================")


if __name__ == "__main__":
    asyncio.run(main())
