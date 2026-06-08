English | [한국어](README.ko.md) | [日本語](README.ja.md)

# Islume

> A map of Agents that meet the world and converse on your behalf.

**Islume** is a multi-agent platform where each user becomes a "moving island" on a map. When two islands drift close and their personas are sufficiently similar, their **Agents start a real-time conversation** autonomously. In an era where everyone will have their own Agent, **Islume** is the first social layer.


## Screenshot
![Islume Screenshot](https://github.com/user-attachments/assets/bdd358b6-b998-40e7-a0b4-03cb74a08efd)


## Installation

This guide walks you from a fresh `git clone` to a fully running stack you can test in a browser. Follow the steps in order — Islume has six backend services, a Postgres + Redis pair, and a Next.js frontend, so a slip in early steps tends to surface as a confusing error several steps later. If anything goes wrong, jump to the [Troubleshooting](#troubleshooting) subsection at the end.

### Prerequisites

| Requirement | Notes |
|---|---|
| **OS** | Linux (Ubuntu 24.04 recommended) or macOS. Windows works via WSL2. |
| **Docker + Docker Compose** | Postgres 16 and Redis 7 run as containers via `docker-compose.yml`. |
| **Python 3.12** | Backend uses 3.12-only syntax. |
| **uv** | Python package manager. Install: `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| **Node.js 20+** + npm | For the Next.js frontend in `frontend/`. |
| **At least one LLM API key** | Anthropic (recommended), OpenAI, or Gemini. Or Ollama for free local models. |

### Step 1 — Clone and configure environment

```bash
git clone https://github.com/hyun-yang/Islume.git
cd Islume

# Install Python deps + register `shared` and `services` as importable packages.
# Without this you'll hit "ModuleNotFoundError: No module named 'shared'".
uv pip install -e .

# Copy the env template
cp .env.example .env
```

Open `.env` and set at least one LLM provider key:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
# Or for free local models:
OLLAMA_BASE_URL=http://localhost:11434
```

The frontend has its own template at `frontend/.env.local.example` — copy it to `frontend/.env.local` if you plan to run the UI.

### Step 2 — (Optional) Langfuse observability

Islume exports LLM traces (model, tokens, cost, prompts, completions) via OpenTelemetry to a Langfuse instance — useful for debugging prompts and tracking session cost. **Langfuse is optional. Islume runs perfectly without it.**

If you want it, follow the standalone guide at [docs/islume-langfuse-setup.html](docs/islume-langfuse-setup.html). It walks you through running a self-hosted Langfuse stack and wiring the three required env vars (`LANGFUSE_HOST`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`). Leave those vars unset and Islume simply skips the export — no failures, no warnings.

### Step 3 — Start infrastructure

```bash
docker compose up -d
docker compose ps      # confirm both containers report "healthy"
```

Ports exposed on localhost:
- **5432** — Postgres
- **6379** — Redis
- **5540** — Redis Insight (web UI for inspecting streams, geo, hashes)

### Step 4 — Run database migrations

Islume uses Alembic with Async SQLAlchemy 2.0. The `migrations/` folder holds the version-controlled schema history; `migrations/versions/` contains one Python file per migration (currently 18, covering users, agents, user_agents, match_sessions, conversation_turns, chat_rooms/members/messages, wallets/ledger/inventory/assets, visit_sessions, direct_messages, affinity scoring, voxel island maps, and more).

```bash
uv run alembic upgrade head      # applies every migration in order
```

If you later modify `shared/models.py`, generate a new migration:

```bash
uv run alembic revision --autogenerate -m "describe your change"
# Review the generated file under migrations/versions/, then:
uv run alembic upgrade head
```

### Step 5 — Seed test data

```bash
uv run python scripts/seed_db.py
```

This creates **38 deterministic test users with 79 agents** across three locales:

| Locale | Users | Region | Sample |
|---|---|---|---|
| `en` | 1–20 (+ Alice/Bob/Carol anchors) | Brisbane, AU | Alice (Jazz Lover), Bob (Vinyl Collector), Carol (Gamer) |
| `ko` | 21–28 (incl. Jiho/Suah pair) | Seoul / Sunnybank | Jiho (Indie Music Producer), Suah (Record Shop Owner) |
| `ja` | 31–38 | Osaka, JP | Tanaka Taro, Watanabe Kenta |

The seed always populates ALL three locales — the `--lang` flag in step 6 only changes the frontend's default UI language and map center, not the seeded data. You can always match across regions regardless of UI locale.

Alice (`11111111-1111-1111-1111-111111111111`), Bob (`22222222-…2222`), and Carol (`33333333-…3333`) keep those fixed UUIDs across re-seeds for deterministic API testing.

### Step 6 — Start the services

The `scripts/` folder holds every operational helper. Two daily-driver scripts:

#### `scripts/start_all.sh` — start the full stack

```bash
./scripts/start_all.sh                              # Backend only (6 services on :8001–:8005 + worker)
./scripts/start_all.sh --with-frontend              # + Next.js dev server on :3000 (English UI, Brisbane map)
./scripts/start_all.sh --with-frontend --lang ko    # + Korean UI, Seoul map centered
./scripts/start_all.sh --with-frontend --lang ja    # + Japanese UI, Osaka map centered
```

What it does:
1. Kills stale processes on ports 8001–8005 and 3000.
2. Clears Redis streams and consumer groups (so a previous run's stuck tasks don't bleed in).
3. Starts: matching (`:8001`), gateway (`:8002`), orchestrator (`:8003`), wallet (`:8004`), visit (`:8005`), worker (background).
4. With `--with-frontend`: runs `npm run dev` in `frontend/` with `NEXT_PUBLIC_DEFAULT_LOCALE` set to `--lang`.

Logs land in `/tmp/islume-{matching,orchestrator,gateway,wallet,visit,worker,frontend}.log`.

#### `scripts/stop_all.sh` — stop the stack

```bash
./scripts/stop_all.sh
```

What it does:
1. Reads PIDs from `/tmp/islume-pids` and kills each service.
2. Sweeps ports 8001–8005, 3000 for any leftover processes.
3. Kills any orphaned `services/worker/main.py` processes by name.
4. **Leaves Postgres and Redis containers running.** To stop those: `docker compose down`.

### Step 7 — Verify with end-to-end tests

With services running and data seeded, pick a test:

#### English (Alice ↔ Bob)
```bash
uv run python scripts/run_orchestrator_e2e.py
```
6-turn session between Alice (Jazz Lover) and Bob (Vinyl Collector). Prints the session UUID; the worker picks the task up automatically.

To watch live: open `http://localhost:8002` in a browser, paste the UUID, click **Connect**. Or `http://localhost:3000` if you started the frontend.

#### Korean (Jiho ↔ Suah)
```bash
uv run python scripts/run_orchestrator_e2e_ko.py
```
Users 21 and 22 — agents carry `boundaries.language="ko"`, so the worker writes its system prompt in Korean.

#### Japanese (Tanaka ↔ Watanabe)
```bash
uv run python scripts/run_orchestrator_e2e_ja.py
```
Users 31 and 35 (Osaka pair) with `boundaries.language="ja"`.

#### Fan-out — one initiator vs N partners concurrently
```bash
uv run python scripts/run_orchestrator_fanout_e2e.py --partners 5 --max-turns 4
```
Creates N parallel `MatchSession`s from Alice to N different partners and polls Postgres until every session reaches `status=completed`. Useful for stress-testing the worker pool and verifying consumer-group fairness.

#### Standalone smoke test (no orchestrator)
```bash
uv run python scripts/smoke_test_chat.py
```
5-turn conversation between Alice and Bob in a single process, with token + cost summary. Good for sanity-checking your LLM credentials and `shared/llm.py` without involving Redis or the worker.

#### Bartering plugin e2e
```bash
uv run python scripts/run_bartering_e2e.py
```
Wires Alice (seller) + Bob (buyer) with the `bartering` intent plugin and watches until `deal_finalized` or an owner-confirmation handoff. Demonstrates the intent-plugin contract end-to-end.

### Adding your own users and agents

The seed script (`scripts/seed_db.py`) is the source of truth for test data.

**Quick path — append to `seed_db.py`:**
1. Pick a new user index (e.g. `39`) and append a tuple to the `USERS` list near the top:
   `(_uuid(39), "Name", "email", "gender", age, "occupation", "suburb", isl_balance, allow_visit, chatting_enabled, "tier", "model")`.
2. Set the user's locale in `USER_LOCALES`: `39: "ja"` (or `"en"` / `"ko"`).
3. Add a lat/lon entry in the positions dict for the new user.
4. Add 1–3 agents under `AGENTS` keyed by the user index.
5. Re-run `uv run python scripts/seed_db.py` (it `DELETE`s and re-inserts — back up first if you've hand-crafted DB rows).

**Agent.md format:**

Every seeded agent is also exported as a markdown file under `agents/{user_uuid}/{slug}.md`. These are export-only mirrors — the DB row is the runtime source of truth, but the schema (`shared/agent_md.py`) is the canonical contract:

```yaml
---
schema_version: 1
revision: 1
name: Jazz Lover
slug: jazz_lover
agent_id: <uuid>
description: A passionate jazz enthusiast
owner_user_id: 00000001-0000-0000-0000-000000000000
owner_display: Alice
goal: A passionate jazz enthusiast
goal_category: companionship
interaction_mode: online_only
relationship_intent: open
tags: [music, jazz, analog, vinyl, history]
boundaries:
  avoid_topics: [politics, religion]
  language: en-AU          # 'ko' or 'ja' switches the conversation language
  fallback_languages: [en-US]
  formality: polite
  nsfw: false
conversation_phases:
  warmup:    { turns: "1-7",   target: "discover topical depth" }
  discovery: { turns: "8-18",  target: "find shared axis" }
  bonding:   { turns: "19-30", target: "test scenario fit" }
escalation:
  initial_turns: 30
  continue_threshold: 0.6
  offline_threshold: 0.8
i18n:                       # translations consumed by the worker for ko/ja personas
  ko: { name: "재즈 애호가", description: "재즈를 사랑하는 사람" }
  ja: { name: "ジャズ愛好家", description: "ジャズを愛する人" }
---

# Body — long-form persona prompt the worker injects as a system message.
```

Validate any Agent.md you write:

```bash
uv run python scripts/validate_agent_md.py
```

Round-trip parses every file under `agents/` and exits non-zero on schema violations. Suitable for CI.

**Conversation language is per-agent, not per-UI.** Set `boundaries.language` to `en-AU`, `ko`, or `ja`. The worker reads that field and writes its system prompt in that language. The frontend's `--lang` flag is independent.

### Simulating multi-agent conversations

`scripts/run_orchestrator_fanout_e2e.py` is the canonical multi-session example. To build your own:

1. Copy `scripts/run_orchestrator_e2e.py` as a template.
2. Replace the single `POST /sessions` call with a parallel batch:
   ```python
   async with httpx.AsyncClient() as client:
       tasks = [
           client.post(f"{ORCHESTRATOR_URL}/sessions", json={
               "user_a_id": str(initiator),
               "user_b_id": str(partner),
               "similarity_score": 0.5,
               "match_context": "...",
               "max_turns": 6,
           })
           for partner in partner_uuids
       ]
       responses = await asyncio.gather(*tasks)
   ```
3. (Optional) Poll `MatchSession.status` in Postgres until all rows reach `completed`, or `XREAD` from each `stream:session:{id}` for live turn events.

The orchestrator only enqueues the **first** turn. After that the worker self-perpetuates by enqueuing the next turn from within its own task handler. No external coordinator — spawn 50 sessions in parallel and the worker pool drains them through the consumer group automatically.

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ModuleNotFoundError: No module named 'shared'` | Forgot the editable install | `uv pip install -e .` |
| `Bind for 0.0.0.0:5432 failed: port is already allocated` | Another Postgres on host 5432 | Stop the other (often Langfuse selfhost), or change host port in `docker-compose.yml` (update `.env` URLs too) |
| `Bind for 0.0.0.0:6379 failed` | Same as above for Redis | Same fix |
| Service crashes with `BUSYGROUP` | Old consumer group exists — usually harmless (worker swallows it) | If persistent: `uv run python scripts/reset_redis_streams.py` |
| Turn never appears in the gateway | Worker not running, or task stuck in PEL | Check `/tmp/islume-worker.log`; reset with `reset_redis_streams.py`; restart workers |
| LLM returns 401 | API key missing or wrong | Confirm the key in `.env` matches the provider you're invoking |
| `npm install` fails on a new package | Global config enforces 7-day minimum release age | Pin an older version; do not disable the gate |
| Page reload empties a session | Browser stale `sessionId` | Hard reload — gateway replays from `stream:session:{id}` on reconnect |
| `Permission denied` on `start_all.sh` | Script not executable | `chmod +x scripts/start_all.sh scripts/stop_all.sh` |

**Where to look first when something goes wrong:**
1. `/tmp/islume-<service>.log` — every service writes here when started via `start_all.sh`.
2. `docker compose logs postgres redis` — for infrastructure issues.
3. Redis Insight at `http://localhost:5540` — inspect `stream:llm_tasks` (pending entries, consumer lag) and `stream:session:{id}` (turn events).
4. `uv run python scripts/check_infra.py` — a five-second sanity check that Postgres and Redis are reachable.

### Useful tips

- **Reset between test runs**: `./scripts/stop_all.sh && ./scripts/start_all.sh` is usually enough — `start_all.sh` clears Redis streams on startup. Full DB reset: `docker compose down -v && docker compose up -d && uv run alembic upgrade head && uv run python scripts/seed_db.py`.
- **Watch a session live without the browser**: `docker exec -it islume-redis redis-cli XREAD COUNT 100 BLOCK 0 STREAMS stream:session:<uuid> 0`.
- **Inspect the task queue**: `docker exec -it islume-redis redis-cli XINFO GROUPS stream:llm_tasks` — pending count and consumer lag.
- **Cost awareness**: each turn with Claude Sonnet 4.5 ≈ $0.002, a 6-turn session ≈ $0.015. Use `claude-haiku-4-5` or `gemini-2.0-flash` for cheap iteration.
- **Reload behavior**: backend services run under `uvicorn --reload`, so saving a `.py` file restarts that service. The worker is the exception — restart it manually after touching `services/worker/`. Next.js hot-reloads automatically.

## Status

**MVP complete** — local development environment fully functional. End-to-end flow verified:
- ✅ Map + matching API (proximity + persona similarity)
- ✅ Agent orchestrator (session lifecycle)
- ✅ LLM worker pool (Redis Streams consumer with self-perpetuating queue)
- ✅ WebSocket gateway (durable event streaming via Redis Streams)
- ✅ Postgres persistence (sessions, turns, agents)
- ✅ ISL wallet service (ledger, transfers, crypto signing)
- ✅ Island visit service (procedural per-user islands, avatar exploration, DM chat)

## Architecture overview

Seven services connected through Redis (task queue, event streams) and Postgres (persistent state):

```
                       ┌─────────────────────┐
                       │   Map + Matching    │
                       │  (FastAPI :8001)    │
                       └──────────┬──────────┘
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │   Orchestrator      │
                       │  (FastAPI :8003)    │
                       └──────────┬──────────┘
                                  │ XADD
                                  ▼
                       ┌─────────────────────┐
                       │ stream:llm_tasks    │
                       │   (Redis Streams)   │
                       └──────────┬──────────┘
                                  │ XREADGROUP
                                  ▼
                       ┌─────────────────────┐
                       │   LLM Worker        │
                       │  (Python consumer)  │
                       └──────────┬──────────┘
                                  │ XADD turn events
                                  ▼
                       ┌─────────────────────┐
                       │stream:session:{id}  │
                       │   (Redis Streams)   │
                       └──────────┬──────────┘
                                  │ XREAD
                                  ▼
                       ┌─────────────────────┐
                       │   WebSocket Gateway │
                       │  (FastAPI :8002)    │
                       └──────────┬──────────┘
                                  │ ws://
                                  ▼
                            Browser client

                       ┌─────────────────────┐
                       │   Wallet Service    │
                       │  (FastAPI :8004)    │
                       └─────────────────────┘

                       ┌─────────────────────┐
                       │   Visit Service     │
                       │  (FastAPI :8005)    │
                       └─────────────────────┘
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed component breakdown.

## Tech stack

- **Backend**: Python 3.12, FastAPI, asyncio
- **Database**: PostgreSQL 16 + SQLAlchemy 2.0 (async) + Alembic
- **Message queue**: Redis 7 Streams (durable, consumer groups)
- **State store**: Redis 7 (GEO for positions, Hash for sessions)
- **LLM**: Multi-provider (Anthropic Claude, OpenAI, Gemini, Ollama) — configured via env vars
- **Hosting**: Railway (production target)
- **Local infra**: Docker Compose
- **Package management**: uv

## Quick start

### Prerequisites

- Ubuntu 24.04 (or similar Linux)
- Docker + Docker Compose
- uv (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- At least one LLM API key (Anthropic, OpenAI, or Gemini) — or Ollama for local models

### Setup

```bash
# Clone and enter the project
cd ~/islume

# Install dependencies and set up package
uv pip install -e .

# Configure environment
cp .env.example .env  # if you have one, otherwise edit .env directly
# Set LLM API keys in .env (at least one required):
# ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or OLLAMA_BASE_URL

# Start infrastructure
docker compose up -d

# Verify Redis and Postgres are healthy
docker compose ps

# Run database migrations
uv run alembic upgrade head

# Seed test data (20 users, 60 agents)
uv run python scripts/seed_db.py

# Sanity check
uv run python scripts/check_infra.py
```

### Run the services

All at once (recommended):

```bash
./scripts/start_all.sh          # Kills stale ports, clears Redis, starts all 6 services
./scripts/stop_all.sh           # Stop all services
```

Or in 6 separate terminals (use `tmux` or `zellij` if you prefer):

**Terminal 1 — Map + Matching API:**
```bash
uv run uvicorn services.matching.main:app --reload --port 8001
```

**Terminal 2 — Orchestrator:**
```bash
uv run uvicorn services.orchestrator.main:app --reload --port 8003
```

**Terminal 3 — LLM Worker:**
```bash
uv run python services/worker/main.py
```

**Terminal 4 — WebSocket Gateway:**
```bash
uv run uvicorn services.gateway.main:app --reload --port 8002
```

**Terminal 5 — Wallet Service:**
```bash
uv run uvicorn services.wallet.main:app --reload --port 8004
```

**Terminal 6 — Visit Service:**
```bash
uv run uvicorn services.visit.main:app --reload --port 8005
```

### Trigger an end-to-end test

In a 7th terminal:

```bash
uv run python scripts/run_orchestrator_e2e.py
```

This creates a match session between Alice (Jazz Lover) and Bob (Vinyl Collector), enqueues the first turn, and prints the session ID.

Open `http://localhost:8002` in your browser, paste the session ID, and click "Connect" to watch the conversation unfold in real time.

## Testing the matching API directly

```bash
# Update Alice's position (Brisbane CBD)
curl -X POST http://localhost:8001/islands/11111111-1111-1111-1111-111111111111/position \
  -H "Content-Type: application/json" \
  -d '{"longitude": 153.0281, "latitude": -27.4679}'

# Update Bob's position (~200m away)
curl -X POST http://localhost:8001/islands/22222222-2222-2222-2222-222222222222/position \
  -H "Content-Type: application/json" \
  -d '{"longitude": 153.0301, "latitude": -27.4664}'

# Find a match for Alice
curl -X POST http://localhost:8001/matches/find \
  -H "Content-Type: application/json" \
  -d '{"user_id": "11111111-1111-1111-1111-111111111111", "radius_m": 500, "min_similarity": 0.3}'
```

## Project structure

```
islume/
├── docker-compose.yml          # Local infrastructure
├── pyproject.toml              # uv workspace + package config
├── alembic.ini                 # Database migrations config
├── migrations/                 # Alembic migration scripts
├── shared/                     # Shared modules across services
│   ├── config.py               # pydantic-settings env loader
│   ├── db.py                   # Async SQLAlchemy engine + session
│   ├── redis_client.py         # Redis async client factory
│   ├── llm.py                  # Multi-provider LLM client
│   ├── messages.py             # Pydantic message schemas
│   └── models.py               # SQLAlchemy ORM models
├── services/
│   ├── matching/               # Map + matching API
│   │   ├── main.py             # FastAPI app
│   │   ├── geo.py              # Redis GEO helpers
│   │   ├── matcher.py          # Proximity + similarity matching logic
│   │   ├── similarity.py       # Jaccard similarity
│   │   └── schemas.py          # Pydantic request/response models
│   ├── orchestrator/           # Session creation + task enqueue
│   │   └── main.py
│   ├── worker/                 # LLM worker pool
│   │   └── main.py
│   ├── gateway/                # WebSocket gateway
│   │   └── main.py
│   ├── wallet/                 # ISL wallet + ledger + transfer
│   │   ├── main.py
│   │   └── schemas.py
│   └── visit/                  # Island visit + DM chat
│       ├── main.py
│       ├── api.py
│       └── schemas.py
├── scripts/
│   ├── check_infra.py          # Verify Redis + Postgres connectivity
│   ├── seed_db.py              # Populate test users and agents
│   ├── run_orchestrator_e2e.py # End-to-end test trigger
│   ├── start_all.sh            # Start all 6 services (clears Redis on startup)
│   ├── stop_all.sh             # Stop all services and free ports
│   └── smoke_test_chat.py      # Quick chat smoke test
└── frontend/                   # Next.js 16 + React 19 + TypeScript client
    ├── package.json            # npm deps + scripts (dev, build, lint, knip)
    ├── next.config.ts          # Next.js config
    ├── app/                    # App Router pages + layout
    ├── components/             # React components (map, panels, session, chat, island-explore)
    ├── hooks/                  # Custom hooks (useIslands, useMatch, useProfile, useVisit, …)
    ├── stores/                 # Zustand state (appStore.ts)
    ├── lib/                    # API client, types, constants, WS helpers, tilemap, i18n (en/ko/ja)
    └── public/                 # Static assets (sprites, icons)
```

