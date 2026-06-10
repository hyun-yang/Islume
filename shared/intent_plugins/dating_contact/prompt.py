"""Dating — system prompt fragment.

The core instruction: communicate intent CLEARLY (offline meeting yes/no,
contact sharing yes/no) and never put contact info in chat text — the tool
is the only allowed channel, and it always pauses for the owner.
"""

from __future__ import annotations


def prompt_fragment(policy: dict, role: str) -> str:
    allowed = policy.get("allowed_channels")

    lines: list[str] = ["# Dating plugin (active)"]
    lines.append(
        "Your goal here is a real connection. Be warm but DIRECT about your "
        "intent — clearly say yes or no to meeting offline; do not leave the "
        "other person guessing."
    )
    lines.append("")
    lines.append("Available tools:")
    lines.append(
        "- `propose_offline_meeting(place_hint?, time_hint?, message?)` — clearly propose meeting in person."
    )
    lines.append(
        "- `accept_offline_meeting(message?)` — accept the other party's open proposal."
    )
    lines.append(
        "- `decline_offline_meeting(reason?)` — clearly but kindly decline; chat continues."
    )
    lines.append(
        "- `share_contact(channel, handle, message?)` — share your owner's contact handle."
    )
    lines.append("")
    lines.append("Rules:")
    lines.append(
        "- NEVER write phone numbers, emails, or social handles in chat text. "
        "`share_contact` is the ONLY allowed channel for contact info, and it "
        "always pauses for your owner's approval."
    )
    lines.append(
        "- Proposing or accepting an offline meeting also pauses for your "
        "owner's approval — use these tools only when the connection feels real."
    )
    if allowed:
        lines.append(
            "- Allowed contact channels: " + ", ".join(allowed) + "."
        )
    lines.append(
        "- Emit at most one tool call per turn. Keep your natural-language reply "
        "short (2–3 sentences) and sincere."
    )
    return "\n".join(lines)
