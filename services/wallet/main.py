"""Wallet service: custodial Ed25519 wallets, double-entry ISL ledger, transfers."""
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException, Query
from sqlalchemy import func as sa_func
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from services.wallet.audit import check_balances, check_tx_group, verify_tx_signature
from services.wallet.idempotency import derive_tx_id
from services.wallet.schemas import (
    BalanceResponse,
    LedgerEntryResponse,
    TransactionHistoryResponse,
    TransferRequest,
    TransferResponse,
    WalletResponse,
    WithdrawalListResponse,
    WithdrawalRequest,
    WithdrawalResponse,
)
from shared.config import get_settings
from shared.crypto import (
    build_tx_data,
    generate_keypair,
    sign_transaction,
    verify_signature,
)
from shared.db import get_sessionmaker
from shared.messages import (
    STREAM_SOLANA_MINTS,
    WalletEvent,
    WithdrawalTask,
    wallet_stream,
)
from shared.models import LedgerEntry, User, Wallet, Withdrawal
from shared.redis_client import close_redis, get_redis
from shared.solana import is_valid_solana_address

GENESIS_AMOUNT = 1000
SYSTEM_USER_ID = UUID("00000000-0000-0000-0000-000000000000")
# Reserved on-chain escrow wallet: receives the credit side of every withdrawal
# so the double-entry invariant holds. escrow.balance == total ISL withdrawn
# on-chain == on-chain SPL supply (withdraw-only flow). Seeded in seed_db.py
# alongside the system wallet. Only ever credited, so it stays >= 0 and needs
# no negative-balance exemption.
ESCROW_USER_ID = UUID("00000000-0000-0000-0000-0000000000e5")
BALANCE_CACHE_TTL = 60  # seconds; bounds staleness if invalidation ever fails


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await close_redis()


app = FastAPI(title="Islume Wallet", lifespan=lifespan)


async def get_session():
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        yield session


@app.get("/health")
async def health():
    return {"status": "ok", "service": "wallet"}


async def _cached_balance(user_id: UUID) -> int | None:
    try:
        cached = await get_redis().get(f"wallet:balance:{user_id}")
    except Exception as e:
        print(f"WARN: redis balance read failed for {user_id}: {e}")
        return None
    return int(cached) if cached is not None else None


async def _cache_balance(user_id: UUID, balance: int) -> None:
    # Cache failures must never fail the request; TTL bounds the staleness.
    try:
        await get_redis().set(
            f"wallet:balance:{user_id}", str(balance), ex=BALANCE_CACHE_TTL
        )
    except Exception as e:
        print(f"WARN: redis balance cache failed for {user_id}: {e}")


async def _get_balance(wallet: Wallet) -> int:
    cached = await _cached_balance(wallet.user_id)
    if cached is not None:
        return cached
    await _cache_balance(wallet.user_id, wallet.balance)
    return wallet.balance


def _wallet_response(wallet: Wallet, balance: int) -> WalletResponse:
    return WalletResponse(
        id=wallet.id,
        user_id=wallet.user_id,
        public_key=wallet.public_key.hex(),
        balance=balance,
        created_at=wallet.created_at.isoformat(),
    )


@app.post("/wallets/{user_id}", response_model=WalletResponse, status_code=201)
async def create_wallet(user_id: UUID, session: AsyncSession = Depends(get_session)):
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    existing = await session.execute(
        select(Wallet).where(Wallet.user_id == user_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Wallet already exists")

    # FOR UPDATE: the system wallet is a hot row under concurrent signups —
    # its balance decrement must be serialized.
    system_wallet = await session.execute(
        select(Wallet).where(Wallet.user_id == SYSTEM_USER_ID).with_for_update()
    )
    sys_wallet = system_wallet.scalar_one_or_none()
    if not sys_wallet:
        raise HTTPException(status_code=500, detail="System wallet not found")

    pub, enc_priv = generate_keypair()
    wallet = Wallet(
        user_id=user_id, public_key=pub, encrypted_private_key=enc_priv,
        balance=GENESIS_AMOUNT,
    )
    session.add(wallet)

    # Deterministic genesis tx_id: a concurrent duplicate request hits the
    # (tx_id, account_id) unique constraint instead of minting twice.
    tx_id = derive_tx_id(SYSTEM_USER_ID, f"genesis:{user_id}")
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status_code=409, detail="Wallet already exists") from None

    tx_data = build_tx_data(
        str(tx_id), str(sys_wallet.id), str(wallet.id),
        GENESIS_AMOUNT, "ISL", "genesis",
    )
    sig = sign_transaction(sys_wallet.encrypted_private_key, tx_data)
    if not verify_signature(sys_wallet.public_key, tx_data, sig):
        raise HTTPException(status_code=500, detail="Signature self-check failed")

    session.add(LedgerEntry(
        tx_id=tx_id, account_id=sys_wallet.id, amount=-GENESIS_AMOUNT,
        currency="ISL", tx_type="genesis", signature=sig,
    ))
    session.add(LedgerEntry(
        tx_id=tx_id, account_id=wallet.id, amount=GENESIS_AMOUNT,
        currency="ISL", tx_type="genesis", signature=sig,
    ))
    sys_wallet.balance -= GENESIS_AMOUNT
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status_code=409, detail="Wallet already exists") from None

    await _cache_balance(user_id, GENESIS_AMOUNT)
    return _wallet_response(wallet, GENESIS_AMOUNT)


@app.get("/wallets/{user_id}", response_model=WalletResponse)
async def get_wallet(user_id: UUID, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(Wallet).where(Wallet.user_id == user_id)
    )
    wallet = result.scalar_one_or_none()
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")

    balance = await _get_balance(wallet)
    return _wallet_response(wallet, balance)


@app.get("/wallets/{user_id}/balance", response_model=BalanceResponse)
async def get_balance(user_id: UUID, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(Wallet).where(Wallet.user_id == user_id)
    )
    wallet = result.scalar_one_or_none()
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")

    balance = await _get_balance(wallet)
    return BalanceResponse(user_id=user_id, balance=balance)


async def _find_replay(
    session: AsyncSession,
    tx_id: UUID,
    sender_wallet_id: UUID,
    receiver_wallet_id: UUID,
    body: TransferRequest,
) -> TransferResponse | None:
    """Look up a previously-committed transfer with this tx_id.

    Returns the stored result as an idempotent replay, None if no such
    transfer exists, or raises 409 if the key was reused with different
    parameters.
    """
    result = await session.execute(
        select(LedgerEntry).where(LedgerEntry.tx_id == tx_id)
    )
    entries = list(result.scalars())
    if not entries:
        return None

    debit = next((e for e in entries if e.amount < 0), None)
    credit = next((e for e in entries if e.amount > 0), None)
    if (
        debit is None
        or credit is None
        or debit.account_id != sender_wallet_id
        or credit.account_id != receiver_wallet_id
        or credit.amount != body.amount
        or debit.tx_type != body.tx_type
    ):
        raise HTTPException(
            status_code=409,
            detail="Idempotency key reused with different parameters",
        )

    return TransferResponse(
        tx_id=tx_id,
        from_user_id=body.from_user_id,
        to_user_id=body.to_user_id,
        amount=body.amount,
        tx_type=body.tx_type,
        created_at=debit.created_at.isoformat(),
        idempotent_replay=True,
    )


@app.post("/transactions/transfer", response_model=TransferResponse)
async def transfer(body: TransferRequest, session: AsyncSession = Depends(get_session)):
    if body.from_user_id == body.to_user_id:
        raise HTTPException(status_code=400, detail="Cannot transfer to self")

    sender_result = await session.execute(
        select(Wallet).where(Wallet.user_id == body.from_user_id)
    )
    sender_wallet = sender_result.scalar_one_or_none()
    if not sender_wallet:
        raise HTTPException(status_code=404, detail="Sender wallet not found")

    receiver_result = await session.execute(
        select(Wallet).where(Wallet.user_id == body.to_user_id)
    )
    receiver_wallet = receiver_result.scalar_one_or_none()
    if not receiver_wallet:
        raise HTTPException(status_code=404, detail="Receiver wallet not found")

    if body.idempotency_key:
        tx_id = derive_tx_id(body.from_user_id, body.idempotency_key)
        replay = await _find_replay(
            session, tx_id, sender_wallet.id, receiver_wallet.id, body
        )
        if replay is not None:
            return replay
    else:
        tx_id = uuid4()

    # Row-lock both wallets in deterministic order (sorted by wallet id) so
    # opposing concurrent transfers can never deadlock.
    first, second = sorted((sender_wallet, receiver_wallet), key=lambda w: w.id)
    await session.refresh(first, with_for_update=True)
    await session.refresh(second, with_for_update=True)

    if sender_wallet.balance < body.amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")

    tx_data = build_tx_data(
        str(tx_id), str(sender_wallet.id), str(receiver_wallet.id),
        body.amount, "ISL", body.tx_type,
    )
    sig = sign_transaction(sender_wallet.encrypted_private_key, tx_data)
    if not verify_signature(sender_wallet.public_key, tx_data, sig):
        raise HTTPException(status_code=500, detail="Signature self-check failed")

    debit = LedgerEntry(
        tx_id=tx_id, account_id=sender_wallet.id, amount=-body.amount,
        currency="ISL", tx_type=body.tx_type,
        tx_metadata=body.metadata, signature=sig,
    )
    credit = LedgerEntry(
        tx_id=tx_id, account_id=receiver_wallet.id, amount=body.amount,
        currency="ISL", tx_type=body.tx_type,
        tx_metadata=body.metadata, signature=sig,
    )
    session.add(debit)
    session.add(credit)
    # Snapshot ids as plain values: rollback expires ORM attributes, and a
    # lazy refresh inside the except block would raise MissingGreenlet.
    sender_wallet_id = sender_wallet.id
    receiver_wallet_id = receiver_wallet.id
    sender_wallet.balance -= body.amount
    receiver_wallet.balance += body.amount
    try:
        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        constraint = str(getattr(e, "orig", e))
        if "uq_ledger_entries_tx_account" in constraint:
            # A concurrent request with the same idempotency key won the race.
            replay = await _find_replay(
                session, tx_id, sender_wallet_id, receiver_wallet_id, body
            )
            if replay is not None:
                return replay
        if "ck_wallets_balance_non_negative" in constraint:
            raise HTTPException(
                status_code=400, detail="Insufficient balance"
            ) from None
        raise
    await session.refresh(debit)

    new_sender_bal = sender_wallet.balance
    new_receiver_bal = receiver_wallet.balance
    await _cache_balance(body.from_user_id, new_sender_bal)
    await _cache_balance(body.to_user_id, new_receiver_bal)

    # Commit-before-publish: events go out only after the DB transaction is
    # durable, and a Redis failure must not turn a committed transfer into a 500.
    try:
        r = get_redis()
        sender_event = WalletEvent(
            event_type="transfer_sent", user_id=body.from_user_id,
            balance=new_sender_bal, tx_id=tx_id, amount=body.amount,
            counterparty_id=body.to_user_id, tx_type=body.tx_type,
        )
        receiver_event = WalletEvent(
            event_type="transfer_received", user_id=body.to_user_id,
            balance=new_receiver_bal, tx_id=tx_id, amount=body.amount,
            counterparty_id=body.from_user_id, tx_type=body.tx_type,
        )
        await r.xadd(wallet_stream(body.from_user_id), sender_event.to_redis())
        await r.xadd(wallet_stream(body.to_user_id), receiver_event.to_redis())
    except Exception as e:
        print(f"WARN: wallet event publish failed for tx {tx_id}: {e}")

    return TransferResponse(
        tx_id=tx_id,
        from_user_id=body.from_user_id,
        to_user_id=body.to_user_id,
        amount=body.amount,
        tx_type=body.tx_type,
        created_at=debit.created_at.isoformat(),
    )


def _withdrawal_response(
    w: Withdrawal, idempotent_replay: bool = False
) -> WithdrawalResponse:
    return WithdrawalResponse(
        withdrawal_id=w.id,
        user_id=w.user_id,
        amount=w.amount,
        destination_address=w.destination_address,
        status=w.status,
        solana_signature=w.solana_signature,
        error=w.error,
        created_at=w.created_at.isoformat(),
        idempotent_replay=idempotent_replay,
    )


async def _find_withdrawal_replay(
    session: AsyncSession, tx_id: UUID, body: WithdrawalRequest
) -> WithdrawalResponse | None:
    """Look up a previously-committed withdrawal for this derived tx_id. Returns
    the stored result as an idempotent replay, None if none exists, or 409 if the
    key was reused with different parameters."""
    result = await session.execute(
        select(Withdrawal).where(Withdrawal.ledger_tx_id == tx_id)
    )
    w = result.scalar_one_or_none()
    if w is None:
        return None
    if (
        w.user_id != body.from_user_id
        or w.amount != body.amount
        or w.destination_address != body.destination_address
    ):
        raise HTTPException(
            status_code=409,
            detail="Idempotency key reused with different parameters",
        )
    return _withdrawal_response(w, idempotent_replay=True)


@app.post("/withdrawals", response_model=WithdrawalResponse, status_code=202)
async def create_withdrawal(
    body: WithdrawalRequest, session: AsyncSession = Depends(get_session)
):
    """Debit ISL (user → escrow) and enqueue an on-chain SPL mint. Returns 202;
    the mint worker mints, confirms, and updates the withdrawal row.

    Mirrors `transfer`: same lock order, signing, idempotency, IntegrityError
    handling, and commit-before-publish."""
    if not is_valid_solana_address(body.destination_address):
        raise HTTPException(status_code=400, detail="Invalid Solana address")
    if body.amount < get_settings().solana_min_withdrawal:
        raise HTTPException(status_code=400, detail="Amount below minimum withdrawal")

    user_result = await session.execute(
        select(Wallet).where(Wallet.user_id == body.from_user_id)
    )
    user_wallet = user_result.scalar_one_or_none()
    if not user_wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")

    escrow_result = await session.execute(
        select(Wallet).where(Wallet.user_id == ESCROW_USER_ID)
    )
    escrow_wallet = escrow_result.scalar_one_or_none()
    if not escrow_wallet:
        raise HTTPException(status_code=500, detail="Escrow wallet not found")

    if body.idempotency_key:
        tx_id = derive_tx_id(body.from_user_id, body.idempotency_key)
        replay = await _find_withdrawal_replay(session, tx_id, body)
        if replay is not None:
            return replay
    else:
        tx_id = uuid4()

    # Lock both wallets in deterministic id order (deadlock-free, mirrors transfer).
    first, second = sorted((user_wallet, escrow_wallet), key=lambda w: w.id)
    await session.refresh(first, with_for_update=True)
    await session.refresh(second, with_for_update=True)

    if user_wallet.balance < body.amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")

    tx_data = build_tx_data(
        str(tx_id), str(user_wallet.id), str(escrow_wallet.id),
        body.amount, "ISL", "withdrawal",
    )
    sig = sign_transaction(user_wallet.encrypted_private_key, tx_data)
    if not verify_signature(user_wallet.public_key, tx_data, sig):
        raise HTTPException(status_code=500, detail="Signature self-check failed")

    meta = {"destination": body.destination_address}
    session.add(LedgerEntry(
        tx_id=tx_id, account_id=user_wallet.id, amount=-body.amount,
        currency="ISL", tx_type="withdrawal", tx_metadata=meta, signature=sig,
    ))
    session.add(LedgerEntry(
        tx_id=tx_id, account_id=escrow_wallet.id, amount=body.amount,
        currency="ISL", tx_type="withdrawal", tx_metadata=meta, signature=sig,
    ))
    withdrawal = Withdrawal(
        user_id=body.from_user_id, wallet_id=user_wallet.id, ledger_tx_id=tx_id,
        amount=body.amount, destination_address=body.destination_address,
        status="pending",
    )
    session.add(withdrawal)

    user_wallet.balance -= body.amount
    escrow_wallet.balance += body.amount
    user_wallet.solana_address = body.destination_address  # UX convenience only

    try:
        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        constraint = str(getattr(e, "orig", e))
        if (
            "uq_ledger_entries_tx_account" in constraint
            or "uq_withdrawals_ledger_tx_id" in constraint
        ):
            replay = await _find_withdrawal_replay(session, tx_id, body)
            if replay is not None:
                return replay
        if "ck_wallets_balance_non_negative" in constraint:
            raise HTTPException(status_code=400, detail="Insufficient balance") from None
        raise
    await session.refresh(withdrawal)

    await _cache_balance(body.from_user_id, user_wallet.balance)

    # Commit-before-publish: the ISL debit is durable before we enqueue the mint.
    # A failed enqueue leaves status="pending" (recoverable by re-enqueue) rather
    # than rolling back a committed debit.
    try:
        await get_redis().xadd(
            STREAM_SOLANA_MINTS, WithdrawalTask(withdrawal_id=withdrawal.id).to_redis()
        )
    except Exception as e:
        print(f"WARN: solana mint enqueue failed for withdrawal {withdrawal.id}: {e}")

    return _withdrawal_response(withdrawal)


@app.get("/wallets/{user_id}/withdrawals", response_model=WithdrawalListResponse)
async def get_withdrawals(
    user_id: UUID,
    limit: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
):
    count_result = await session.execute(
        select(sa_func.count()).where(Withdrawal.user_id == user_id)
    )
    total = count_result.scalar_one()
    result = await session.execute(
        select(Withdrawal)
        .where(Withdrawal.user_id == user_id)
        .order_by(Withdrawal.created_at.desc())
        .limit(limit)
    )
    return WithdrawalListResponse(
        withdrawals=[_withdrawal_response(w) for w in result.scalars()],
        total=total,
    )


@app.get("/wallets/{user_id}/transactions", response_model=TransactionHistoryResponse)
async def get_transactions(
    user_id: UUID,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(Wallet).where(Wallet.user_id == user_id)
    )
    wallet = result.scalar_one_or_none()
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")

    count_result = await session.execute(
        select(sa_func.count()).where(LedgerEntry.account_id == wallet.id)
    )
    total = count_result.scalar_one()

    entries_result = await session.execute(
        select(LedgerEntry)
        .where(LedgerEntry.account_id == wallet.id)
        .order_by(LedgerEntry.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    entries = list(entries_result.scalars())

    return TransactionHistoryResponse(
        entries=[
            LedgerEntryResponse(
                id=e.id,
                tx_id=e.tx_id,
                amount=e.amount,
                currency=e.currency,
                tx_type=e.tx_type,
                tx_metadata=e.tx_metadata,
                created_at=e.created_at.isoformat(),
            )
            for e in entries
        ],
        total=total,
        offset=offset,
        limit=limit,
    )


@app.get("/audit/ledger")
async def audit_ledger(
    limit_txs: int | None = Query(None, ge=1),
    session: AsyncSession = Depends(get_session),
):
    """Verify ledger invariants: double-entry pairs, signatures, balances."""
    wallets_result = await session.execute(select(Wallet))
    wallets = list(wallets_result.scalars())
    pubkey_by_wallet = {w.id: w.public_key for w in wallets}
    materialized = {w.id: w.balance for w in wallets}
    system_wallet_id = next(
        (w.id for w in wallets if w.user_id == SYSTEM_USER_ID), None
    )

    sums_result = await session.execute(
        select(LedgerEntry.account_id, sa_func.sum(LedgerEntry.amount))
        .group_by(LedgerEntry.account_id)
    )
    summed = {account_id: int(total) for account_id, total in sums_result.all()}

    entries_result = await session.execute(select(LedgerEntry))
    groups: dict[UUID, list[LedgerEntry]] = {}
    for entry in entries_result.scalars():
        groups.setdefault(entry.tx_id, []).append(entry)

    anomalies: list[dict] = []
    checked = 0
    for tx_id, group in groups.items():
        if limit_txs is not None and checked >= limit_txs:
            break
        checked += 1
        problems = check_tx_group(group)
        for problem in problems:
            anomalies.append(
                {"kind": "tx_invariant", "tx_id": str(tx_id), "detail": problem}
            )
        if not problems and not verify_tx_signature(tx_id, group, pubkey_by_wallet):
            anomalies.append(
                {
                    "kind": "bad_signature",
                    "tx_id": str(tx_id),
                    "detail": "signature does not verify against debit wallet key",
                }
            )

    for problem in check_balances(materialized, summed, system_wallet_id):
        anomalies.append({"kind": "balance", "detail": problem})

    return {
        "ok": not anomalies,
        "transactions_checked": checked,
        "wallets_checked": len(wallets),
        "anomalies": anomalies,
    }


@app.get("/wallets/{user_id}/inventory")
async def get_inventory(user_id: UUID):
    return []


@app.get("/wallets/{user_id}/assets")
async def get_assets(user_id: UUID):
    return []
