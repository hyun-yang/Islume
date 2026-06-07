"""End-to-end test: trigger orchestrator and watch worker process the conversation.

Run this AFTER starting the orchestrator and worker in separate terminals.
This script just sends the HTTP POST to /sessions and prints the result.
"""
import asyncio

import httpx

ORCHESTRATOR_URL = "http://localhost:8003"
USER_A = "00000001-0000-0000-0000-000000000000"
USER_B = "00000002-0000-0000-0000-000000000000"


async def main():
    payload = {
        "user_a_id": USER_A,
        "user_b_id": USER_B,
        "similarity_score": 0.43,
        "match_context": "You both share a love of analog music — vinyl records, jazz, and the warmth of physical sound.",
        "max_turns": 6,
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{ORCHESTRATOR_URL}/sessions", json=payload)
        resp.raise_for_status()
        result = resp.json()
        print(f"Created session: {result['session_id']}")
        print(f"Status: {result['status']}")
        print()
        print("Watch the worker terminal for live conversation output.")
        print("After completion, query Postgres to see persisted turns:")
        print("  SELECT turn_number, agent_id, content FROM conversation_turns")
        print(f"  WHERE session_id = '{result['session_id']}'")
        print("  ORDER BY turn_number;")


if __name__ == "__main__":
    asyncio.run(main())