[English](README.md) | 한국어 | [日本語](README.ja.md)

# Islume

> 당신을 대신해 세상과 만나고, 대화하는 Agent들의 지도.

**Islume**은 사용자가 지도 위 "움직이는 섬"이 되어, 가까워진 다른 섬과 페르소나가 충분히 비슷하면 두 사람의 **Agent끼리 실시간 대화**을 시작하는 멀티 에이전트 플랫폼입니다. 누구나 자신의 Agent를 갖는 시대, **Islume**은 그 첫 번째 소셜 레이어입니다.


## 스크린샷
![Islume Chat](https://github.com/user-attachments/assets/f47af8eb-5503-4f4f-9151-ab479e1f3e63)

![Islume Game](https://github.com/user-attachments/assets/c8c09aae-7111-4bfa-b9f4-470d2dd24fd5)

![Islume RSP](https://github.com/user-attachments/assets/2cf33a08-9899-4818-bb02-0b9f1f317593)


## 설치

`git clone` 직후부터 브라우저에서 동작 확인까지의 전체 절차입니다. Islume은 백엔드 서비스 6개 + Postgres/Redis + Next.js 프론트엔드로 구성되어 있어, 초반 단계에서 한 가지를 빠뜨리면 한참 뒤에 알 수 없는 에러로 나타납니다. **순서대로** 진행하세요. 문제가 생기면 마지막의 [문제 해결](#문제-해결) 절을 먼저 보세요.

### 사전 요구사항

| 항목 | 비고 |
|---|---|
| **OS** | Linux (Ubuntu 24.04 권장) 또는 macOS. Windows는 WSL2로 가능. |
| **Docker + Docker Compose** | Postgres 16과 Redis 7을 `docker-compose.yml`로 컨테이너 실행. |
| **Python 3.12** | 백엔드가 3.12 전용 문법 사용. |
| **uv** | Python 패키지 매니저. 설치: `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| **Node.js 20+** + npm | `frontend/`의 Next.js 앱용. |
| **LLM API 키 최소 1개** | Anthropic(권장), OpenAI, Gemini 중 하나. 무료로는 Ollama 로컬 모델. |

### 1단계 — 클론 및 환경 설정

```bash
git clone https://github.com/hyun-yang/Islume.git
cd Islume

# Python 의존성 설치 + shared/services 패키지를 import 가능한 형태로 등록.
# 이 단계를 빠뜨리면 "ModuleNotFoundError: No module named 'shared'" 에러 발생.
uv pip install -e .

# 환경변수 템플릿 복사
cp .env.example .env
```

`.env`를 열어 LLM 프로바이더 키를 최소 1개 설정:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
# 또는 무료 로컬 모델용:
OLLAMA_BASE_URL=http://localhost:11434
```

프론트엔드는 별도 템플릿 `frontend/.env.local.example`이 있습니다. UI를 실행할 거면 `frontend/.env.local`로 복사하세요.

### 2단계 — (선택) Langfuse 관측성

Islume은 LLM 호출 트레이스(모델, 토큰, 비용, 프롬프트, 응답)를 OpenTelemetry로 Langfuse 인스턴스에 내보낼 수 있습니다 — 프롬프트 디버깅과 세션 비용 추적에 유용합니다. **Langfuse는 선택 사항입니다. Islume은 Langfuse 없이도 완벽하게 동작합니다.**

원한다면 [docs/islume-langfuse-setup.html](docs/islume-langfuse-setup.html)의 별도 가이드를 따라 셀프호스팅 Langfuse 스택을 구성하고 필수 환경변수 3개(`LANGFUSE_HOST`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`)를 설정하면 됩니다. 이 변수들을 비워두면 Islume은 단순히 export를 건너뜁니다 — 에러도, 경고도 없습니다.

### 3단계 — 인프라 실행

```bash
docker compose up -d
docker compose ps      # 두 컨테이너가 "healthy"인지 확인
```

localhost에 노출되는 포트:
- **5432** — Postgres
- **6379** — Redis
- **5540** — Redis Insight (스트림, GEO, Hash을 검사하는 웹 UI)

### 4단계 — 데이터베이스 마이그레이션

Islume은 Alembic + Async SQLAlchemy 2.0을 사용합니다. `migrations/` 폴더는 버전 관리되는 스키마 히스토리를 담고 있으며, `migrations/versions/`에 마이그레이션마다 Python 파일이 1개씩 존재합니다 (현재 18개 — users, agents, user_agents, match_sessions, conversation_turns, chat_rooms/members/messages, wallets/ledger/inventory/assets, visit_sessions, direct_messages, affinity scoring, voxel island maps 등을 다룸).

```bash
uv run alembic upgrade head      # 모든 마이그레이션을 순서대로 적용
```

이후 `shared/models.py`를 수정했다면 새 마이그레이션 생성:

```bash
uv run alembic revision --autogenerate -m "변경 내용 설명"
# migrations/versions/ 아래의 생성 파일을 검토한 뒤:
uv run alembic upgrade head
```

### 5단계 — 테스트 데이터 시드

```bash
uv run python scripts/seed_db.py
```

세 가지 로케일에 걸쳐 **결정론적 테스트 사용자 38명 + 에이전트 79개**를 생성합니다:

| 로케일 | 사용자 | 지역 | 예시 |
|---|---|---|---|
| `en` | 1–20 (+ Alice/Bob/Carol 앵커) | Brisbane, AU | Alice (Jazz Lover), Bob (Vinyl Collector), Carol (Gamer) |
| `ko` | 21–28 (Jiho/Suah 페어 포함) | Seoul / Sunnybank | Jiho (인디 음악 프로듀서), Suah (레코드숍 사장) |
| `ja` | 31–38 | Osaka, JP | Tanaka Taro, Watanabe Kenta |

시드는 항상 세 가지 로케일을 모두 채웁니다 — 6단계의 `--lang` 플래그는 프론트엔드 기본 UI 언어와 지도 중심점만 바꾸며, 시드 데이터는 영향받지 않습니다. UI 로케일과 무관하게 어떤 지역끼리든 매칭 가능합니다.

Alice (`11111111-1111-1111-1111-111111111111`), Bob (`22222222-…2222`), Carol (`33333333-…3333`)은 결정론적 API 테스트를 위해 재시드에도 고정된 UUID를 유지합니다.

### 6단계 — 서비스 실행

`scripts/` 폴더에는 모든 운영용 헬퍼가 있습니다. 일상적으로 쓰는 두 가지 스크립트:

#### `scripts/start_all.sh` — 전체 스택 시작

```bash
./scripts/start_all.sh                              # 백엔드만 (:8001–:8005 6개 서비스 + 워커)
./scripts/start_all.sh --with-frontend              # + :3000에서 Next.js 개발 서버 (영어 UI, Brisbane 지도)
./scripts/start_all.sh --with-frontend --lang ko    # + 한국어 UI, Seoul 지도 중심
./scripts/start_all.sh --with-frontend --lang ja    # + 일본어 UI, Osaka 지도 중심
```

동작 방식:
1. 포트 8001–8005, 3000의 잔여 프로세스 종료.
2. Redis 스트림과 컨슈머 그룹 초기화 (이전 실행의 멈춘 작업이 섞이지 않도록).
3. 다음 서비스 시작: matching (`:8001`), gateway (`:8002`), orchestrator (`:8003`), wallet (`:8004`), visit (`:8005`), worker (백그라운드).
4. `--with-frontend` 지정 시: `frontend/`에서 `npm run dev` 실행 (`NEXT_PUBLIC_DEFAULT_LOCALE`을 `--lang` 값으로 설정).

로그는 `/tmp/islume-{matching,orchestrator,gateway,wallet,visit,worker,frontend}.log`에 기록됩니다.

#### `scripts/stop_all.sh` — 스택 종료

```bash
./scripts/stop_all.sh
```

동작 방식:
1. `/tmp/islume-pids`에서 PID들을 읽어 각 서비스 종료.
2. 포트 8001–8005, 3000에 남은 프로세스 정리.
3. 이름으로 남아있을 수 있는 `services/worker/main.py` 프로세스 종료.
4. **Postgres와 Redis 컨테이너는 그대로 둡니다.** 이들도 멈추려면: `docker compose down`.

### 7단계 — 엔드투엔드 테스트로 동작 확인

서비스가 실행 중이고 데이터 시드도 끝났다면 테스트 하나를 선택:

#### 영어 (Alice ↔ Bob)
```bash
uv run python scripts/run_orchestrator_e2e.py
```
Alice(Jazz Lover)와 Bob(Vinyl Collector) 간의 6턴 세션. 세션 UUID를 출력하면 워커가 자동으로 작업을 픽업합니다.

라이브로 보려면: 브라우저에서 `http://localhost:8002`를 열고 UUID 붙여넣은 뒤 **Connect** 클릭. 프론트엔드를 시작했다면 `http://localhost:3000`도 가능.

#### 한국어 (Jiho ↔ Suah)
```bash
uv run python scripts/run_orchestrator_e2e_ko.py
```
사용자 21번과 22번 — 두 에이전트가 `boundaries.language="ko"`이므로 워커가 한국어로 시스템 프롬프트를 생성합니다.

#### 일본어 (Tanaka ↔ Watanabe)
```bash
uv run python scripts/run_orchestrator_e2e_ja.py
```
사용자 31번과 35번 (Osaka 페어), `boundaries.language="ja"`.

#### 팬아웃 — 한 사용자 대 N명의 파트너 동시 진행
```bash
uv run python scripts/run_orchestrator_fanout_e2e.py --partners 5 --max-turns 4
```
Alice에서 N개의 다른 파트너로 향하는 N개의 `MatchSession`을 병렬 생성하고, 모든 세션이 `status=completed`에 도달할 때까지 Postgres를 폴링합니다. 워커 풀 부하 테스트와 컨슈머 그룹 공정성 검증에 유용.

#### 독립 스모크 테스트 (오케스트레이터 불필요)
```bash
uv run python scripts/smoke_test_chat.py
```
Alice와 Bob 간 5턴 대화를 단일 프로세스에서 실행, 토큰/비용 요약 출력. Redis나 워커 없이 LLM 자격증명과 `shared/llm.py`의 동작 점검에 좋음.

#### 바터링 플러그인 엔드투엔드
```bash
uv run python scripts/run_bartering_e2e.py
```
Alice(판매자) + Bob(구매자)에 `bartering` 의도 플러그인을 연결하고 `deal_finalized` 이벤트 또는 소유자 확인 핸드오프 시점까지 세션 스트림을 관찰합니다. 의도 플러그인 계약의 엔드투엔드 시연.

### 자신만의 사용자/에이전트 추가하기

테스트 데이터의 원천은 시드 스크립트(`scripts/seed_db.py`)입니다.

**빠른 방법 — `seed_db.py`에 추가:**
1. 새 사용자 인덱스(예: `39`)를 골라 파일 상단의 `USERS` 리스트에 튜플 추가:
   `(_uuid(39), "이름", "email", "gender", age, "직업", "지역", isl_balance, allow_visit, chatting_enabled, "tier", "model")`.
2. `USER_LOCALES`에 사용자 로케일 설정: `39: "ja"` (또는 `"en"` / `"ko"`).
3. 좌표 dict에 새 사용자의 lat/lon 항목 추가.
4. `AGENTS` dict 아래에 해당 사용자 인덱스를 키로 1–3개 에이전트 추가.
5. `uv run python scripts/seed_db.py` 재실행 (DB를 `DELETE` 후 재삽입하므로 손수 작성한 데이터가 있다면 백업 먼저).

**Agent.md 포맷:**

시드된 모든 에이전트는 `agents/{user_uuid}/{slug}.md` 파일로도 내보내집니다. 이는 export-only 미러본이며, 런타임의 진실 공급원은 DB 행입니다. 하지만 `shared/agent_md.py`의 스키마가 정식 계약입니다:

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
  language: en-AU          # 'ko' 또는 'ja'로 바꾸면 대화 언어가 바뀜
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
i18n:                       # 워커가 ko/ja 페르소나에 사용하는 번역
  ko: { name: "재즈 애호가", description: "재즈를 사랑하는 사람" }
  ja: { name: "ジャズ愛好家", description: "ジャズを愛する人" }
---

# 본문 — 워커가 시스템 메시지로 주입하는 장문 페르소나 프롬프트.
```

작성한 Agent.md를 검증:

```bash
uv run python scripts/validate_agent_md.py
```

`agents/` 아래 모든 파일을 라운드트립 파싱하고 스키마 위반 시 0이 아닌 값으로 종료합니다. CI에 적합.

**대화 언어는 UI가 아니라 에이전트별로 결정됩니다.** `boundaries.language`를 `en-AU`, `ko`, `ja` 중 하나로 설정하면 워커가 해당 언어로 시스템 프롬프트를 작성합니다. 프론트엔드의 `--lang` 플래그와는 독립적입니다.

### 멀티 에이전트 대화 시뮬레이션 만들기

`scripts/run_orchestrator_fanout_e2e.py`가 다중 세션의 표준 예시입니다. 직접 만들려면:

1. `scripts/run_orchestrator_e2e.py`를 템플릿으로 복사.
2. 단일 `POST /sessions` 호출을 병렬 배치로 교체:
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
3. (선택) Postgres의 `MatchSession.status`가 모두 `completed`가 될 때까지 폴링하거나, 각 `stream:session:{id}`에 `XREAD`로 라이브 턴 이벤트 수신.

오케스트레이터는 **첫 턴만** 큐에 등록합니다. 이후 워커가 자기 태스크 핸들러 안에서 다음 턴을 큐에 추가하며 자가 영속화합니다. 외부 코디네이터가 필요 없습니다 — 50개 세션을 병렬로 띄워도 워커 풀이 컨슈머 그룹을 통해 자동으로 처리합니다.

### 문제 해결

| 증상 | 원인 추정 | 해결 |
|---|---|---|
| `ModuleNotFoundError: No module named 'shared'` | editable install 누락 | `uv pip install -e .` |
| `Bind for 0.0.0.0:5432 failed: port is already allocated` | 호스트 5432에 다른 Postgres | 다른 인스턴스(주로 Langfuse 셀프호스트) 중지, 또는 `docker-compose.yml`에서 호스트 포트 변경 (`.env`의 URL도 함께) |
| `Bind for 0.0.0.0:6379 failed` | Redis에 같은 문제 | 같은 방식으로 해결 |
| 시작 시 `BUSYGROUP` 크래시 | 기존 컨슈머 그룹 존재 — 보통 무해 (워커가 swallow) | 지속되면: `uv run python scripts/reset_redis_streams.py` |
| 게이트웨이에 턴이 안 나타남 | 워커 미실행 또는 PEL에 작업 stuck | `/tmp/islume-worker.log` 확인, `reset_redis_streams.py`로 초기화 후 워커 재시작 |
| LLM이 401 반환 | API 키 누락/오류 | `.env`의 키가 호출하는 프로바이더와 일치하는지 확인 |
| `npm install`이 새 패키지에서 실패 | 글로벌 설정의 7일 최소 릴리스 연식 가드 | 더 오래된 버전 핀; 가드를 끄지 말 것 |
| 페이지 새로고침으로 세션 턴이 비어버림 | 브라우저의 오래된 `sessionId` | 강제 새로고침 — 게이트웨이가 `stream:session:{id}`에서 재생함 |
| `start_all.sh`에 `Permission denied` | 실행 권한 없음 | `chmod +x scripts/start_all.sh scripts/stop_all.sh` |

**문제가 생기면 먼저 확인할 곳:**
1. `/tmp/islume-<service>.log` — `start_all.sh`로 시작한 모든 서비스가 여기에 기록.
2. `docker compose logs postgres redis` — 인프라 이슈용.
3. `http://localhost:5540`의 Redis Insight — `stream:llm_tasks` (펜딩 엔트리, 컨슈머 lag)와 `stream:session:{id}` (턴 이벤트) 검사.
4. `uv run python scripts/check_infra.py` — Postgres와 Redis 연결을 5초 안에 점검.

### 유용한 팁

- **테스트 실행 사이 리셋**: `./scripts/stop_all.sh && ./scripts/start_all.sh`로 보통 충분합니다 — `start_all.sh`가 시작 시 Redis 스트림을 비웁니다. DB 전체 리셋: `docker compose down -v && docker compose up -d && uv run alembic upgrade head && uv run python scripts/seed_db.py`.
- **브라우저 없이 세션 라이브 보기**: `docker exec -it islume-redis redis-cli XREAD COUNT 100 BLOCK 0 STREAMS stream:session:<uuid> 0`.
- **작업 큐 점검**: `docker exec -it islume-redis redis-cli XINFO GROUPS stream:llm_tasks` — 펜딩 카운트와 컨슈머 lag.
- **비용 인지**: Claude Sonnet 4.5 한 턴 ≈ $0.002, 6턴 세션 ≈ $0.015. 빠른 반복엔 `claude-haiku-4-5`나 `gemini-2.0-flash` 사용.
- **리로드 동작**: 백엔드 서비스는 `uvicorn --reload`로 돌아가서 `.py` 저장 시 해당 서비스가 재시작됩니다. 워커는 예외 — `services/worker/`를 수정하면 수동 재시작. Next.js는 자동 핫리로드.

## 현재 상태

**MVP 완료** — 로컬 개발 환경이 모두 동작합니다. 엔드투엔드 흐름 검증 완료:
- ✅ 지도 + 매칭 API (근접도 + 페르소나 유사도)
- ✅ 에이전트 오케스트레이터 (세션 생애주기)
- ✅ LLM 워커 풀 (자가 영속 큐를 가진 Redis Streams 컨슈머)
- ✅ WebSocket 게이트웨이 (Redis Streams 기반 내구성 이벤트 스트리밍)
- ✅ Postgres 영속화 (세션, 턴, 에이전트)
- ✅ ISL 지갑 서비스 (원장, 송금, 암호 서명)
- ✅ 섬 방문 서비스 (절차적 생성 섬, 아바타 탐험, DM 채팅)

> **온체인 ISL (선택, Devnet 전용):** 출금 시 ISL을 Solana SPL 토큰으로 **Devnet**에 발행할 수 있습니다 — 실가치가 없는 기술 데모입니다. `scripts/solana_create_mint.py`를 실행해 본인 Devnet mint를 생성하거나, `SOLANA_ISL_MINT` / `SOLANA_MINT_AUTHORITY_SECRET`를 비워두면 발행이 비활성화됩니다 (나머지 앱은 그대로 동작).

## 아키텍처 개요

7개의 서비스가 Redis(작업 큐, 이벤트 스트림)와 Postgres(영속 상태)를 통해 연결됩니다:

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

자세한 컴포넌트 분석은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)를 참고하세요.

## 기술 스택

- **백엔드**: Python 3.12, FastAPI, asyncio
- **데이터베이스**: PostgreSQL 16 + SQLAlchemy 2.0 (async) + Alembic
- **메시지 큐**: Redis 7 Streams (내구성, 컨슈머 그룹)
- **상태 저장소**: Redis 7 (위치 GEO, 세션 Hash)
- **LLM**: 멀티 프로바이더 (Anthropic Claude, OpenAI, Gemini, Ollama) — 환경변수로 설정
- **호스팅**: Railway (프로덕션 타겟)
- **로컬 인프라**: Docker Compose
- **패키지 관리**: uv

## 빠른 시작

### 사전 요구사항

- Ubuntu 24.04 (또는 유사 리눅스)
- Docker + Docker Compose
- uv (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- LLM API 키 최소 1개 (Anthropic, OpenAI, Gemini) — 또는 로컬 모델용 Ollama

### 설치

```bash
# 클론 후 프로젝트로 이동
cd ~/islume

# 의존성 설치 및 패키지 셋업
uv pip install -e .

# 환경변수 설정
cp .env.example .env  # 있는 경우, 없으면 .env 직접 편집
# .env에 LLM API 키 설정 (최소 1개 필요):
# ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, 또는 OLLAMA_BASE_URL

# 인프라 시작
docker compose up -d

# Redis와 Postgres가 정상인지 확인
docker compose ps

# 데이터베이스 마이그레이션 실행
uv run alembic upgrade head

# 테스트 데이터 시드 (20명 사용자, 60개 에이전트)
uv run python scripts/seed_db.py

# 인프라 점검
uv run python scripts/check_infra.py
```

### 서비스 실행

한 번에 모두 실행 (권장):

```bash
./scripts/start_all.sh          # 잔여 포트 정리, Redis 초기화, 모든 6개 서비스 시작
./scripts/stop_all.sh           # 모든 서비스 종료
```

또는 6개의 별도 터미널에서 (`tmux`나 `zellij` 사용 권장):

**터미널 1 — 지도 + 매칭 API:**
```bash
uv run uvicorn services.matching.main:app --reload --port 8001
```

**터미널 2 — 오케스트레이터:**
```bash
uv run uvicorn services.orchestrator.main:app --reload --port 8003
```

**터미널 3 — LLM 워커:**
```bash
uv run python services/worker/main.py
```

**터미널 4 — WebSocket 게이트웨이:**
```bash
uv run uvicorn services.gateway.main:app --reload --port 8002
```

**터미널 5 — 지갑 서비스:**
```bash
uv run uvicorn services.wallet.main:app --reload --port 8004
```

**터미널 6 — 방문 서비스:**
```bash
uv run uvicorn services.visit.main:app --reload --port 8005
```

### 엔드투엔드 테스트 실행

7번째 터미널에서:

```bash
uv run python scripts/run_orchestrator_e2e.py
```

Alice(Jazz Lover)와 Bob(Vinyl Collector) 사이의 매치 세션을 생성하고, 첫 턴을 큐에 넣은 뒤 세션 ID를 출력합니다.

브라우저에서 `http://localhost:8002`를 열고 세션 ID를 붙여넣은 후 "Connect"를 클릭하면, 대화가 실시간으로 전개되는 모습을 볼 수 있습니다.

## 매칭 API 직접 테스트

```bash
# Alice 위치 업데이트 (Brisbane CBD)
curl -X POST http://localhost:8001/islands/11111111-1111-1111-1111-111111111111/position \
  -H "Content-Type: application/json" \
  -d '{"longitude": 153.0281, "latitude": -27.4679}'

# Bob 위치 업데이트 (~200m 떨어진 곳)
curl -X POST http://localhost:8001/islands/22222222-2222-2222-2222-222222222222/position \
  -H "Content-Type: application/json" \
  -d '{"longitude": 153.0301, "latitude": -27.4664}'

# Alice의 매치 찾기
curl -X POST http://localhost:8001/matches/find \
  -H "Content-Type: application/json" \
  -d '{"user_id": "11111111-1111-1111-1111-111111111111", "radius_m": 500, "min_similarity": 0.3}'
```

## 프로젝트 구조

```
islume/
├── docker-compose.yml          # 로컬 인프라
├── pyproject.toml              # uv 워크스페이스 + 패키지 설정
├── alembic.ini                 # 데이터베이스 마이그레이션 설정
├── migrations/                 # Alembic 마이그레이션 스크립트
├── shared/                     # 서비스 간 공유 모듈
│   ├── config.py               # pydantic-settings 환경 로더
│   ├── db.py                   # 비동기 SQLAlchemy 엔진 + 세션
│   ├── redis_client.py         # Redis 비동기 클라이언트 팩토리
│   ├── llm.py                  # 멀티 프로바이더 LLM 클라이언트
│   ├── messages.py             # Pydantic 메시지 스키마
│   └── models.py               # SQLAlchemy ORM 모델
├── services/
│   ├── matching/               # 지도 + 매칭 API
│   │   ├── main.py             # FastAPI 앱
│   │   ├── geo.py              # Redis GEO 헬퍼
│   │   ├── matcher.py          # 근접도 + 유사도 매칭 로직
│   │   ├── similarity.py       # 자카드 유사도
│   │   └── schemas.py          # Pydantic 요청/응답 모델
│   ├── orchestrator/           # 세션 생성 + 작업 큐 등록
│   │   └── main.py
│   ├── worker/                 # LLM 워커 풀
│   │   └── main.py
│   ├── gateway/                # WebSocket 게이트웨이
│   │   └── main.py
│   ├── wallet/                 # ISL 지갑 + 원장 + 송금
│   │   ├── main.py
│   │   └── schemas.py
│   └── visit/                  # 섬 방문 + DM 채팅
│       ├── main.py
│       ├── api.py
│       └── schemas.py
├── scripts/
│   ├── check_infra.py          # Redis + Postgres 연결 확인
│   ├── seed_db.py              # 테스트 사용자와 에이전트 시드
│   ├── run_orchestrator_e2e.py # 엔드투엔드 테스트 트리거
│   ├── start_all.sh            # 6개 서비스 모두 시작 (시작 시 Redis 초기화)
│   ├── stop_all.sh             # 모든 서비스 종료 및 포트 해제
│   └── smoke_test_chat.py      # 빠른 채팅 스모크 테스트
└── frontend/                   # Next.js 16 + React 19 + TypeScript 클라이언트
    ├── package.json            # npm 의존성 + 스크립트 (dev, build, lint, knip)
    ├── next.config.ts          # Next.js 설정
    ├── app/                    # App Router 페이지 + 레이아웃
    ├── components/             # React 컴포넌트 (map, panels, session, chat, island-explore)
    ├── hooks/                  # 커스텀 훅 (useIslands, useMatch, useProfile, useVisit, …)
    ├── stores/                 # Zustand 상태 (appStore.ts)
    ├── lib/                    # API 클라이언트, 타입, 상수, WS 헬퍼, 타일맵, i18n (en/ko/ja)
    └── public/                 # 정적 자산 (스프라이트, 아이콘)
```

