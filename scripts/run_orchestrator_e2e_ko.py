"""Korean end-to-end test: trigger a session between the seeded Korean pair.

Mirrors run_orchestrator_e2e.py but targets Jiho (user 21) and Suah (user 22),
whose active agents (Indie Music Lover / City Pop Collector) carry a `ko`
translation + boundaries.language="ko", so the worker converses in Korean.

Run AFTER starting the orchestrator and worker. Requires a fresh seed
(scripts/seed_db.py) so the Korean pair exists.
"""
import asyncio

import httpx

ORCHESTRATOR_URL = "http://localhost:8003"
USER_A = "00000021-0000-0000-0000-000000000000"  # Jiho
USER_B = "00000022-0000-0000-0000-000000000000"  # Suah


async def main():
    payload = {
        "user_a_id": USER_A,
        "user_b_id": USER_B,
        "similarity_score": 0.5,
        "match_context": "두 분 모두 아날로그 음악을 사랑합니다 — 바이닐 레코드, 인디, 시티팝, 그리고 따뜻한 아날로그 사운드.",
        "max_turns": 6,
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{ORCHESTRATOR_URL}/sessions", json=payload)
        resp.raise_for_status()
        result = resp.json()
        print(f"Created session: {result['session_id']}")
        print(f"Status: {result['status']}")
        print()
        print("Watch the worker terminal for the live Korean conversation.")
        print("After completion, query Postgres to see persisted turns:")
        print("  SELECT turn_number, agent_id, content FROM conversation_turns")
        print(f"  WHERE session_id = '{result['session_id']}'")
        print("  ORDER BY turn_number;")


if __name__ == "__main__":
    asyncio.run(main())
