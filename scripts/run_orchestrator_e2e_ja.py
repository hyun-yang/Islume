"""Japanese end-to-end test: trigger a session between a seeded Osaka pair.

Mirrors run_orchestrator_e2e_ko.py but targets Tanaka Taro (user 31) and
Watanabe Kenta (user 35), whose active agents carry boundaries.language="ja"
and Japanese personas (shared analog-music tags so they match), so the worker
converses in Japanese.

Run AFTER starting the orchestrator and worker. Requires a fresh seed
(scripts/seed_db.py) so the Osaka users exist.
"""
import asyncio

import httpx

ORCHESTRATOR_URL = "http://localhost:8003"
USER_A = "00000031-0000-0000-0000-000000000000"  # 田中太郎 (Tanaka Taro)
USER_B = "00000035-0000-0000-0000-000000000000"  # 渡辺健太 (Watanabe Kenta)


async def main():
    payload = {
        "user_a_id": USER_A,
        "user_b_id": USER_B,
        "similarity_score": 0.5,
        "match_context": "お二人ともアナログ音楽を愛しています — レコード、ジャズ、シティポップ、そして温かみのあるアナログサウンド。",
        "max_turns": 6,
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{ORCHESTRATOR_URL}/sessions", json=payload)
        resp.raise_for_status()
        result = resp.json()
        print(f"Created session: {result['session_id']}")
        print(f"Status: {result['status']}")
        print()
        print("Watch the worker terminal for the live Japanese conversation.")
        print("After completion, query Postgres to see persisted turns:")
        print("  SELECT turn_number, agent_id, content FROM conversation_turns")
        print(f"  WHERE session_id = '{result['session_id']}'")
        print("  ORDER BY turn_number;")


if __name__ == "__main__":
    asyncio.run(main())
