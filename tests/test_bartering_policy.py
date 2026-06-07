"""Bartering policy_check — every branch (auto_confirm / pending / auto_rejected)."""

from __future__ import annotations

from shared.intent_plugins.bartering import policy as bp

SELLER_POLICY = {
    "role": "seller",
    "item_name": "vintage Polaroid",
    "currency": "ISL",
    "price_range": {"min": 30, "max": 60},
    "auto_accept_at_or_above": 55,
    "auto_reject_below": 25,
}


# ---- propose_price ----------------------------------------------------------


def test_propose_in_range_auto_confirm() -> None:
    d = bp.check_propose_price({"amount": 40}, SELLER_POLICY)
    assert d.status == "auto_confirm"


def test_propose_below_auto_reject_threshold_auto_rejected() -> None:
    d = bp.check_propose_price({"amount": 10}, SELLER_POLICY)
    assert d.status == "auto_rejected"
    assert "auto_reject_below" in d.reason


def test_propose_below_range_but_above_reject_floor_pending() -> None:
    d = bp.check_propose_price({"amount": 27}, SELLER_POLICY)
    # 27 is below price_range.min=30 but above auto_reject_below=25 → pending
    assert d.status == "pending"


def test_propose_above_range_pending() -> None:
    d = bp.check_propose_price({"amount": 90}, SELLER_POLICY)
    assert d.status == "pending"


def test_propose_non_integer_amount_auto_rejected() -> None:
    d = bp.check_propose_price({"amount": "forty"}, SELLER_POLICY)
    assert d.status == "auto_rejected"


def test_propose_missing_amount_auto_rejected() -> None:
    d = bp.check_propose_price({}, SELLER_POLICY)
    assert d.status == "auto_rejected"


# ---- counter_offer (alias of propose_price) --------------------------------


def test_counter_offer_uses_same_bounds() -> None:
    assert bp.check_counter_offer is bp.check_propose_price


# ---- accept_offer ----------------------------------------------------------


def test_accept_at_or_above_floor_auto_confirm() -> None:
    d = bp.check_accept_offer({"amount": 55}, SELLER_POLICY)
    assert d.status == "auto_confirm"


def test_accept_just_below_floor_pending() -> None:
    d = bp.check_accept_offer({"amount": 50}, SELLER_POLICY)
    assert d.status == "pending"


def test_accept_outside_range_pending() -> None:
    d = bp.check_accept_offer({"amount": 25}, SELLER_POLICY)
    # 25 is in range [30,60]? No, below 30 → outside range
    assert d.status == "pending"


def test_accept_non_integer_auto_rejected() -> None:
    d = bp.check_accept_offer({"amount": None}, SELLER_POLICY)
    assert d.status == "auto_rejected"


def test_accept_without_floor_falls_through_to_pending() -> None:
    policy_no_floor = {**SELLER_POLICY}
    policy_no_floor.pop("auto_accept_at_or_above")
    d = bp.check_accept_offer({"amount": 40}, policy_no_floor)
    assert d.status == "pending"


# ---- reject / withdraw -----------------------------------------------------


def test_reject_offer_always_auto() -> None:
    assert bp.check_reject_offer({}, SELLER_POLICY).status == "auto_confirm"
    assert (
        bp.check_reject_offer({"reason": "x"}, SELLER_POLICY).status == "auto_confirm"
    )


def test_withdraw_always_auto() -> None:
    assert bp.check_withdraw({}, SELLER_POLICY).status == "auto_confirm"


# ---- share_reference -------------------------------------------------------


def test_share_reference_default_wildcard_auto() -> None:
    d = bp.check_share_reference(
        {"kind": "photo", "url": "https://example.com/x.jpg"}, SELLER_POLICY
    )
    assert d.status == "auto_confirm"


def test_share_reference_with_allow_list() -> None:
    pol = {**SELLER_POLICY, "allowed_reference_hosts": ["example.com"]}
    ok = bp.check_share_reference(
        {"kind": "photo", "url": "https://example.com/x.jpg"}, pol
    )
    bad = bp.check_share_reference(
        {"kind": "photo", "url": "https://other.com/x.jpg"}, pol
    )
    assert ok.status == "auto_confirm"
    assert bad.status == "pending"


def test_share_reference_wildcard_explicit() -> None:
    pol = {**SELLER_POLICY, "allowed_reference_hosts": ["*"]}
    d = bp.check_share_reference(
        {"kind": "photo", "url": "https://anywhere.example/x.jpg"}, pol
    )
    assert d.status == "auto_confirm"


def test_share_reference_malformed_url_blocked_by_allow_list() -> None:
    pol = {**SELLER_POLICY, "allowed_reference_hosts": ["example.com"]}
    d = bp.check_share_reference({"kind": "photo", "url": "not-a-url"}, pol)
    assert d.status == "pending"
