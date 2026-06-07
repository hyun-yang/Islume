"""Wallet service: custodial Ed25519 wallets, double-entry ISL ledger, transfers."""
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException, Query
from sqlalchemy import func as sa_func
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from services.wallet.schemas import (
    BalanceResponse,
    LedgerEntryResponse,
    TransactionHistoryResponse,
    TransferRequest,
    TransferResponse,
    WalletResponse,
)
from shared.crypto import build_tx_data, generate_keypair, sign_transaction
from shared.db import get_sessionmaker
from shared.messages import WalletEvent, wallet_stream
from shared.models import LedgerEntry, User, Wallet
from shared.redis_client import close_redis, get_redis

GENESIS_AMOUNT = 1000
SYSTEM_USER_ID = UUID("00000000-0000-0000-0000-000000000000")


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


async def _get_balance_from_db(session: AsyncSession, wallet_id: UUID) -> int:
    result = await session.execute(
        select(sa_func.coalesce(sa_func.sum(LedgerEntry.amount), 0))
        .where(LedgerEntry.account_id == wallet_id)
    )
    return int(result.scalar_one())


async def _get_balance(session: AsyncSession, wallet: Wallet) -> int:
    r = get_redis()
    cached = await r.get(f"wallet:balance:{wallet.user_id}")
    if cached is not None:
        return int(cached)
    balance = await _get_balance_from_db(session, wallet.id)
    await r.set(f"wallet:balance:{wallet.user_id}", str(balance))
    return balance


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

    system_wallet = await session.execute(
        select(Wallet).where(Wallet.user_id == SYSTEM_USER_ID)
    )
    sys_wallet = system_wallet.scalar_one_or_none()
    if not sys_wallet:
        raise HTTPException(status_code=500, detail="System wallet not found")

    pub, enc_priv = generate_keypair()
    wallet = Wallet(user_id=user_id, public_key=pub, encrypted_private_key=enc_priv)
    session.add(wallet)
    await session.flush()

    tx_id = uuid4()
    tx_data = build_tx_data(
        str(tx_id), str(sys_wallet.id), str(wallet.id),
        GENESIS_AMOUNT, "ISL", "genesis",
    )
    sig = sign_transaction(sys_wallet.encrypted_private_key, tx_data)

    session.add(LedgerEntry(
        tx_id=tx_id, account_id=sys_wallet.id, amount=-GENESIS_AMOUNT,
        currency="ISL", tx_type="genesis", signature=sig,
    ))
    session.add(LedgerEntry(
        tx_id=tx_id, account_id=wallet.id, amount=GENESIS_AMOUNT,
        currency="ISL", tx_type="genesis", signature=sig,
    ))
    await session.commit()

    r = get_redis()
    await r.set(f"wallet:balance:{user_id}", str(GENESIS_AMOUNT))

    return _wallet_response(wallet, GENESIS_AMOUNT)


@app.get("/wallets/{user_id}", response_model=WalletResponse)
async def get_wallet(user_id: UUID, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(Wallet).where(Wallet.user_id == user_id)
    )
    wallet = result.scalar_one_or_none()
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")

    balance = await _get_balance(session, wallet)
    return _wallet_response(wallet, balance)


@app.get("/wallets/{user_id}/balance", response_model=BalanceResponse)
async def get_balance(user_id: UUID, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(Wallet).where(Wallet.user_id == user_id)
    )
    wallet = result.scalar_one_or_none()
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")

    balance = await _get_balance(session, wallet)
    return BalanceResponse(user_id=user_id, balance=balance)


@app.post("/transactions/transfer", response_model=TransferResponse)
async def transfer(body: TransferRequest, session: AsyncSession = Depends(get_session)):
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

    lock_id = int.from_bytes(sender_wallet.id.bytes[:8], "big") % (2**63)
    await session.execute(text("SELECT pg_advisory_xact_lock(:lock_id)"), {"lock_id": lock_id})

    sender_balance = await _get_balance_from_db(session, sender_wallet.id)
    if sender_balance < body.amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")

    tx_id = uuid4()
    tx_data = build_tx_data(
        str(tx_id), str(sender_wallet.id), str(receiver_wallet.id),
        body.amount, "ISL", body.tx_type,
    )
    sig = sign_transaction(sender_wallet.encrypted_private_key, tx_data)

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
    await session.commit()
    await session.refresh(debit)

    r = get_redis()
    await r.delete(f"wallet:balance:{body.from_user_id}")
    await r.delete(f"wallet:balance:{body.to_user_id}")

    new_sender_bal = sender_balance - body.amount
    new_receiver_bal = await _get_balance_from_db(session, receiver_wallet.id)

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

    await r.set(f"wallet:balance:{body.from_user_id}", str(new_sender_bal))
    await r.set(f"wallet:balance:{body.to_user_id}", str(new_receiver_bal))

    return TransferResponse(
        tx_id=tx_id,
        from_user_id=body.from_user_id,
        to_user_id=body.to_user_id,
        amount=body.amount,
        tx_type=body.tx_type,
        created_at=debit.created_at.isoformat(),
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


@app.get("/wallets/{user_id}/inventory")
async def get_inventory(user_id: UUID):
    return []


@app.get("/wallets/{user_id}/assets")
async def get_assets(user_id: UUID):
    return []
