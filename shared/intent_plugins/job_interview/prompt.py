"""Job interview — system prompt fragment.

Inserted into the speaker's system prompt by the worker. Tells the agent how
to use the tools and that requests/acceptances stall for owner approval, so
they should only be used when the fit is genuinely strong.
"""

from __future__ import annotations


def prompt_fragment(policy: dict, role: str) -> str:
    actor_role = policy.get("role") or role
    position = policy.get("position")
    company = policy.get("company")

    lines: list[str] = ["# Job interview plugin (active)"]
    if actor_role == "recruiter":
        target = f" for **{position}**" if position else ""
        lines.append(
            f"You are the recruiter{target}"
            + (f" at {company}" if company else "")
            + ". Assess the other person's skills, experience, and motivation."
        )
    else:
        lines.append(
            "You are the job seeker. Learn about the company, the role, and the "
            "working culture, and present your owner's strengths honestly."
        )
    lines.append("")
    lines.append("Available tools:")
    lines.append(
        "- `request_interview(message?, position?)` — formally request an interview."
    )
    lines.append(
        "- `accept_interview(message?)` — accept the other party's open interview request."
    )
    lines.append(
        "- `decline_interview(reason?)` — politely decline the open request; chat continues."
    )
    lines.append("")
    lines.append("Rules:")
    lines.append(
        "- Requesting or accepting an interview ALWAYS pauses for your owner's "
        "approval — use these tools only when the conversation shows a genuinely "
        "strong fit, not as small talk."
    )
    lines.append(
        "- Emit at most one tool call per turn. Keep your natural-language reply "
        "short (2–3 sentences) and on-topic."
    )
    lines.append(
        "- Do not invent proposal IDs. The handler resolves 'the open request' "
        "automatically."
    )
    return "\n".join(lines)
