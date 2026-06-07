"""Smoke test: run a 5-turn conversation between two matched personas.

Loads Alice and Bob from the seeded DB, builds persona prompts with match
context, and alternates LLM calls for 5 turns. Prints turns to the terminal
with token usage and cost summary.
"""
import asyncio
from uuid import UUID

from sqlalchemy import select

from shared.db import get_sessionmaker
from shared.llm import LLMResponse, generate
from shared.models import Agent, User, UserAgent

USER_A = UUID("11111111-1111-1111-1111-111111111111")
USER_B = UUID("22222222-2222-2222-2222-222222222222")
TURNS = 5
MATCH_CONTEXT = "You both share a love of analog music — vinyl records, jazz, and the warmth of physical sound."

# ANSI colors for terminal output
COLOR_A = "\033[36m"  # cyan
COLOR_B = "\033[35m"  # magenta
COLOR_DIM = "\033[2m"
COLOR_BOLD = "\033[1m"
COLOR_RESET = "\033[0m"


def build_system_prompt(agent: Agent, partner_name: str, match_context: str) -> str:
    """Construct the system prompt for one persona in a matched conversation."""
    return f"""{agent.persona_prompt}

You are {agent.name}. Your tone is {agent.tone}.

You have just been matched with another person named {partner_name} on a virtual map.
The reason you were matched: {match_context}

Have a natural, casual conversation. Keep your responses short — 2 to 4 sentences.
Stay in character. Don't break the fourth wall or mention that you are an AI."""


async def load_agent_for_user(session, user_id: UUID) -> tuple[User, Agent]:
    stmt = (
        select(User, Agent)
        .join(UserAgent, UserAgent.user_id == User.id)
        .join(Agent, Agent.id == UserAgent.agent_id)
        .where(User.id == user_id, UserAgent.is_active.is_(True))
    )
    result = await session.execute(stmt)
    row = result.one()
    return row[0], row[1]


def print_turn(speaker_name: str, color: str, text: str, response: LLMResponse):
    print(f"\n{color}{COLOR_BOLD}{speaker_name}{COLOR_RESET}{color}: {text}{COLOR_RESET}")
    print(
        f"{COLOR_DIM}    [in: {response.input_tokens} tok, "
        f"out: {response.output_tokens} tok, "
        f"cost: ${response.cost_usd:.5f}]{COLOR_RESET}"
    )


async def main():
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        user_a, agent_a = await load_agent_for_user(session, USER_A)
        user_b, agent_b = await load_agent_for_user(session, USER_B)

    print(f"\n{COLOR_BOLD}=== Islume Smoke Test: Persona Conversation ==={COLOR_RESET}")
    print(f"{COLOR_DIM}Match context: {MATCH_CONTEXT}{COLOR_RESET}")
    print(f"{COLOR_DIM}Turns: {TURNS}{COLOR_RESET}")

    system_a = build_system_prompt(agent_a, user_b.display_name, MATCH_CONTEXT)
    system_b = build_system_prompt(agent_b, user_a.display_name, MATCH_CONTEXT)

    # Conversation history is a list of {role, content} dicts.
    # From A's perspective: A's own turns are "assistant", B's are "user".
    # From B's perspective: it's the mirror — B's own turns are "assistant", A's are "user".
    history_a: list[dict] = []
    history_b: list[dict] = []

    total_cost = 0.0
    total_input = 0
    total_output = 0

    # Seed the conversation: A speaks first with a friendly opener
    initial_user_message = "(Start the conversation with a friendly opener.)"
    history_a.append({"role": "user", "content": initial_user_message})

    current_speaker = "A"
    for _turn in range(1, TURNS + 1):
        if current_speaker == "A":
            response = await generate(system=system_a, messages=history_a)
            print_turn(f"{user_a.display_name} ({agent_a.name})", COLOR_A, response.text, response)
            # Record A's turn in both histories
            history_a.append({"role": "assistant", "content": response.text})
            history_b.append({"role": "user", "content": response.text})
            current_speaker = "B"
        else:
            response = await generate(system=system_b, messages=history_b)
            print_turn(f"{user_b.display_name} ({agent_b.name})", COLOR_B, response.text, response)
            history_b.append({"role": "assistant", "content": response.text})
            history_a.append({"role": "user", "content": response.text})
            current_speaker = "A"

        total_cost += response.cost_usd
        total_input += response.input_tokens
        total_output += response.output_tokens

    print(f"\n{COLOR_BOLD}=== Summary ==={COLOR_RESET}")
    print(f"  Total turns: {TURNS}")
    print(f"  Total input tokens:  {total_input}")
    print(f"  Total output tokens: {total_output}")
    print(f"  Total cost: ${total_cost:.5f}")
    print(f"  Avg per turn: ${total_cost / TURNS:.5f}")


if __name__ == "__main__":
    asyncio.run(main())
