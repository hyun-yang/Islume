"""Pydantic request/response schemas for the Wallet service."""
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class WalletResponse(BaseModel):
    id: UUID
    user_id: UUID
    public_key: str
    solana_address: str
    balance: int
    created_at: str


class BalanceResponse(BaseModel):
    user_id: UUID
    balance: int
    currency: str = "ISL"


class TransferRequest(BaseModel):
    from_user_id: UUID
    to_user_id: UUID
    amount: int = Field(..., gt=0)
    tx_type: str = "tip"
    metadata: dict | None = None
    idempotency_key: str | None = Field(None, min_length=1, max_length=128)


class TransferResponse(BaseModel):
    tx_id: UUID
    from_user_id: UUID
    to_user_id: UUID
    amount: int
    tx_type: str
    created_at: str
    idempotent_replay: bool = False


class AdminAdjustRequest(BaseModel):
    user_id: UUID
    amount: int = Field(..., gt=0)
    direction: Literal["credit", "debit"]  # credit increases, debit decreases
    reason: str = Field(..., min_length=1, max_length=500)
    idempotency_key: str | None = Field(None, min_length=1, max_length=128)


class AdminAdjustResponse(BaseModel):
    tx_id: UUID
    user_id: UUID
    direction: str
    amount: int
    new_balance: int
    reason: str
    created_at: str
    idempotent_replay: bool = False


class WithdrawalRequest(BaseModel):
    from_user_id: UUID
    amount: int = Field(..., gt=0)
    destination_address: str = Field(..., min_length=32, max_length=64)
    idempotency_key: str | None = Field(None, min_length=1, max_length=128)


class WithdrawalResponse(BaseModel):
    withdrawal_id: UUID
    user_id: UUID
    amount: int
    destination_address: str
    status: str
    solana_signature: str | None = None
    error: str | None = None
    created_at: str
    idempotent_replay: bool = False


class WithdrawalListResponse(BaseModel):
    withdrawals: list[WithdrawalResponse]
    total: int


class LedgerEntryResponse(BaseModel):
    id: int
    tx_id: UUID
    amount: int
    currency: str
    tx_type: str
    tx_metadata: dict | None
    created_at: str


class TransactionHistoryResponse(BaseModel):
    entries: list[LedgerEntryResponse]
    total: int
    offset: int
    limit: int
