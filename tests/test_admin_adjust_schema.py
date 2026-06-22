"""AdminAdjustRequest validation — DB-free schema checks."""
from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from services.wallet.schemas import AdminAdjustRequest

UID = uuid.UUID("00000001-0000-0000-0000-000000000000")


def _base(**over):
    data = {"user_id": str(UID), "amount": 100, "direction": "credit", "reason": "test"}
    data.update(over)
    return data


def test_valid_credit() -> None:
    req = AdminAdjustRequest(**_base())
    assert req.direction == "credit"
    assert req.amount == 100
    assert req.idempotency_key is None


def test_valid_debit() -> None:
    assert AdminAdjustRequest(**_base(direction="debit")).direction == "debit"


def test_amount_must_be_positive() -> None:
    with pytest.raises(ValidationError):
        AdminAdjustRequest(**_base(amount=0))
    with pytest.raises(ValidationError):
        AdminAdjustRequest(**_base(amount=-5))


def test_reason_required_nonempty() -> None:
    with pytest.raises(ValidationError):
        AdminAdjustRequest(**_base(reason=""))


def test_direction_must_be_credit_or_debit() -> None:
    with pytest.raises(ValidationError):
        AdminAdjustRequest(**_base(direction="mint"))


def test_idempotency_key_optional() -> None:
    assert AdminAdjustRequest(**_base(idempotency_key="abc")).idempotency_key == "abc"
