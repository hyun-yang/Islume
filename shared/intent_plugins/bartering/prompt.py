"""Bartering — system prompt fragment.

Inserted into the speaker's system prompt by the worker, after persona/safety blocks.
The fragment exposes the owner's policy bounds in natural language so the LLM picks
amounts that will auto-confirm (no pending stall).
"""

from __future__ import annotations


def prompt_fragment(policy: dict, role: str) -> str:
    """Render a plain-text instruction block for the speaker.

    `role` is informational (passed by the worker — usually inferred from policy.role
    or from the speaker's position in the trade).
    """
    item = policy.get("item_name", "the item")
    currency = policy.get("currency", "ISL")
    pr = policy.get("price_range") or {}
    lo, hi = pr.get("min"), pr.get("max")
    floor = policy.get("auto_accept_at_or_above")
    reject = policy.get("auto_reject_below")
    actor_role = policy.get("role") or role
    photo = policy.get("photo_url")

    lines: list[str] = ["# Bartering plugin (active)"]
    lines.append(
        f"You are the {actor_role} in a negotiation over **{item}** (currency: {currency})."
    )
    lines.append("")
    lines.append("Available tools:")
    lines.append(
        "- `propose_price(amount, currency, item_name, terms?)` — start or replace a price offer."
    )
    lines.append(
        "- `counter_offer(amount, terms?)` — counter the currently open proposal."
    )
    lines.append(
        "- `accept_offer(amount)` — accept the open proposal (amount must match it)."
    )
    lines.append(
        "- `reject_offer(reason?)` — reject the open proposal; chat continues."
    )
    lines.append("- `share_reference(kind, url, label?)` — share a photo/link/doc URL.")
    lines.append("- `withdraw(reason?)` — close all open proposals; chat continues.")
    lines.append("")
    lines.append(
        "Your owner's policy (you must respect these bounds — actions outside them require human confirmation and stall the chat):"
    )
    if lo is not None and hi is not None:
        lines.append(
            f"- price_range: amounts {lo}–{hi} {currency} are within your authority."
        )
    if floor is not None:
        lines.append(
            f"- auto_accept_at_or_above: you may accept offers ≥ {floor} {currency} automatically; lower offers need human approval."
        )
    if reject is not None:
        lines.append(
            f"- auto_reject_below: offers < {reject} {currency} are automatically rejected without further negotiation."
        )
    if photo:
        lines.append(f"- you may share this URL when useful: {photo}")
    lines.append("")
    lines.append("Rules:")
    lines.append(
        "- Emit at most one tool call per turn. Keep your natural-language reply short (2–3 sentences) and on-topic."
    )
    lines.append(
        "- A deal is finalized when one side calls `accept_offer` with the open proposal's amount. Until then, keep negotiating."
    )
    lines.append(
        "- Do not invent proposal IDs. The handler resolves 'the open proposal' automatically; just choose actions that fit the current state."
    )

    return "\n".join(lines)
