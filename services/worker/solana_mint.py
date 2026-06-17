"""Solana mint worker: consumes withdrawal tasks, mints SPL tokens on-chain.

A standalone consumer (separate process / consumer group) so the wallet HTTP
service stays stateless and the on-chain concern is isolated — mirrors the LLM
worker's loop: XREADGROUP, XACK only after success, id="0", mkstream, BUSYGROUP
swallow.

The withdrawal row drives a state machine (pending → minting → confirmed/failed);
there is no external coordinator. Exactly-once strategy: persist the submitted
signature BEFORE confirming, and on reclaim reconcile via signature_status()
instead of blindly re-minting. Residual risk: a crash between RPC accepting the
tx (signature generated) and the COMMIT of that signature — small, acceptable on
Devnet. See docs/JOURNAL.md.
"""
import asyncio
import os
import traceback
from datetime import datetime
from uuid import UUID

from shared.config import get_settings
from shared.db import get_sessionmaker
from shared.messages import (
    SOLANA_MINTERS,
    STREAM_SOLANA_MINTS,
    WalletEvent,
    WithdrawalTask,
    wallet_stream,
)
from shared.models import Withdrawal
from shared.redis_client import close_redis, get_redis
from shared.solana import confirm_mint, mint_isl_to, signature_status

WORKER_NAME = f"solana-minter-{os.getpid()}"
BLOCK_MS = 5000


async def _publish(w: Withdrawal, event_type: str) -> None:
    """Notify the owner's wallet stream (best-effort; the durable record is the
    withdrawals row, which the frontend polls)."""
    try:
        ev = WalletEvent(
            event_type=event_type,
            user_id=w.user_id,
            tx_id=w.ledger_tx_id,
            amount=w.amount,
        )
        await get_redis().xadd(wallet_stream(w.user_id), ev.to_redis())
    except Exception as e:
        print(f"WARN: wallet event publish failed for withdrawal {w.id}: {e}")


async def process_withdrawal(withdrawal_id: UUID) -> None:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        w = await db.get(Withdrawal, withdrawal_id)
        if w is None:
            print(f"  [skip] withdrawal {withdrawal_id} not found")
            return
        if w.status == "confirmed":
            return  # duplicate delivery — already done
        if w.status == "failed":
            return  # do not auto-retry a failed withdrawal

        max_attempts = get_settings().solana_mint_max_attempts

        # Reconcile: a prior attempt already submitted a signature. Check the
        # chain BEFORE minting again so we never double-mint.
        if w.solana_signature:
            status = await signature_status(w.solana_signature)
            if status == "confirmed":
                w.status = "confirmed"
                w.confirmed_at = datetime.utcnow()
                await db.commit()
                await _publish(w, "withdrawal_confirmed")
                print(f"  [reconcile] withdrawal {w.id} already on-chain")
                return
            # "failed" or None (dropped / never landed) → safe to (re)mint below.

        # Claim: pending → minting.
        w.status = "minting"
        w.attempts = (w.attempts or 0) + 1
        attempts = w.attempts
        await db.commit()

        try:
            sig = await mint_isl_to(w.destination_address, w.amount)
        except Exception as e:
            w.error = str(e)[:500]
            if attempts >= max_attempts:
                w.status = "failed"
                await db.commit()
                await _publish(w, "withdrawal_failed")
                print(f"  [mint] withdrawal {w.id} FAILED after {attempts} attempts: {e}")
                return  # give up — ACK so it stops looping
            w.status = "pending"  # reset for a future retry
            await db.commit()
            raise  # leave in PEL (no XACK)

        # Linchpin: persist the signature BEFORE confirming, so a crash during
        # confirmation can't lose it (reclaim reconciles via signature_status).
        w.solana_signature = sig
        await db.commit()

        ok, reason = await confirm_mint(sig)
        if ok:
            w.status = "confirmed"
            w.confirmed_at = datetime.utcnow()
            await db.commit()
            await _publish(w, "withdrawal_confirmed")
            print(f"  [mint] withdrawal {w.id} confirmed: {sig}")
            return

        # Submitted but not confirmed (timeout / transient). The tx may still
        # land — keep status "minting" + signature so reclaim reconciles rather
        # than re-mints. Mark failed only once attempts are exhausted.
        w.error = (reason or "confirm_failed")[:500]
        if attempts >= max_attempts:
            w.status = "failed"
            await db.commit()
            await _publish(w, "withdrawal_failed")
            print(f"  [mint] withdrawal {w.id} unconfirmed, giving up: {reason}")
            return
        await db.commit()  # stays "minting" with signature recorded
        raise RuntimeError(f"withdrawal {w.id} confirm failed: {reason}")


async def run_worker():
    r = get_redis()
    try:
        await r.xgroup_create(
            STREAM_SOLANA_MINTS, SOLANA_MINTERS, id="0", mkstream=True
        )
    except Exception as e:
        if "BUSYGROUP" not in str(e):
            raise
    print(f"Solana mint worker {WORKER_NAME} started, listening on {STREAM_SOLANA_MINTS}")

    while True:
        try:
            response = await r.xreadgroup(
                groupname=SOLANA_MINTERS,
                consumername=WORKER_NAME,
                streams={STREAM_SOLANA_MINTS: ">"},
                count=1,
                block=BLOCK_MS,
            )
        except Exception as e:
            print(f"Error reading from stream: {e}")
            await asyncio.sleep(1)
            continue

        if not response:
            continue

        for _stream_name, entries in response:
            for entry_id, data in entries:
                try:
                    task = WithdrawalTask.from_redis(data)
                    await process_withdrawal(task.withdrawal_id)
                    await r.xack(STREAM_SOLANA_MINTS, SOLANA_MINTERS, entry_id)
                except Exception as e:
                    print(f"Error processing mint task {entry_id}: {e}")
                    traceback.print_exc()


async def main():
    try:
        await run_worker()
    finally:
        await close_redis()


if __name__ == "__main__":
    asyncio.run(main())
