# Islume

> あなたに代わって世界と出会い、対話するAgentたちの地図。

**Islume** は、ユーザー一人ひとりが地図上の「動く島」となるマルチエージェントプラットフォームです。2つの島が近づき、互いのペルソナが十分に似ていれば、それぞれの **Agent同士が自律的にリアルタイム会話**を開始します。誰もが自分のAgentを持つ時代、**Islume** はその最初のソーシャルレイヤーです。

## インストール

`git clone` 直後からブラウザで動作確認できる状態までの完全な手順です。Islumeはバックエンド6サービス + Postgres/Redis + Next.jsフロントエンドで構成されているため、序盤の一つの取りこぼしが後半で原因不明のエラーとして現れがちです。**順序通り**進めてください。問題が起きたら最後の[トラブルシューティング](#トラブルシューティング)を先に確認してください。

### 前提条件

| 項目 | 備考 |
|---|---|
| **OS** | Linux (Ubuntu 24.04 推奨) または macOS。Windows は WSL2 経由で可。 |
| **Docker + Docker Compose** | Postgres 16 と Redis 7 を `docker-compose.yml` でコンテナ実行。 |
| **Python 3.12** | バックエンドが 3.12 専用構文を使用。 |
| **uv** | Python パッケージマネージャ。インストール: `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| **Node.js 20+** + npm | `frontend/` の Next.js アプリ用。 |
| **LLM API キー最低 1 つ** | Anthropic (推奨)、OpenAI、Gemini のいずれか。または無料の Ollama ローカルモデル。 |

### ステップ1 — クローンと環境設定

```bash
git clone https://github.com/hyun-yang/Islume.git
cd Islume

# Python 依存関係をインストールし、shared/services をインポート可能なパッケージとして登録。
# このステップを忘れると "ModuleNotFoundError: No module named 'shared'" になります。
uv pip install -e .

# 環境変数テンプレートをコピー
cp .env.example .env
```

`.env` を開いて LLM プロバイダーキーを最低 1 つ設定:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
# または無料のローカルモデル:
OLLAMA_BASE_URL=http://localhost:11434
```

フロントエンドには `frontend/.env.local.example` という別のテンプレートがあります。UI を起動する予定なら `frontend/.env.local` にコピーしてください。

### ステップ2 — (オプション) Langfuse 可観測性

Islume は LLM 呼び出しトレース (モデル、トークン、コスト、プロンプト、応答) を OpenTelemetry 経由で Langfuse インスタンスへエクスポートできます — プロンプトのデバッグやセッションコストの追跡に有用です。**Langfuse はオプションです。Islume は Langfuse なしでも問題なく動作します。**

導入する場合は [docs/islume-langfuse-setup.html](docs/islume-langfuse-setup.html) のスタンドアロンガイドに従ってください。セルフホスティング Langfuse スタックの実行方法と、必須環境変数 3 つ (`LANGFUSE_HOST`、`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`) の設定が記載されています。これらの変数を未設定のままにすれば、Islume は単にエクスポートをスキップします — エラーも警告もありません。

### ステップ3 — インフラ起動

```bash
docker compose up -d
docker compose ps      # 両コンテナが "healthy" であることを確認
```

localhost に公開されるポート:
- **5432** — Postgres
- **6379** — Redis
- **5540** — Redis Insight (ストリーム、GEO、Hash を検査する Web UI)

### ステップ4 — データベースマイグレーション

Islume は Alembic + Async SQLAlchemy 2.0 を使用します。`migrations/` フォルダがバージョン管理されたスキーマ履歴を保持し、`migrations/versions/` にはマイグレーションごとに 1 つの Python ファイルがあります (現在 18 個 — users、agents、user_agents、match_sessions、conversation_turns、chat_rooms/members/messages、wallets/ledger/inventory/assets、visit_sessions、direct_messages、affinity スコアリング、voxel island maps など)。

```bash
uv run alembic upgrade head      # 全マイグレーションを順に適用
```

後で `shared/models.py` を変更した場合は新規マイグレーションを生成:

```bash
uv run alembic revision --autogenerate -m "変更内容の説明"
# migrations/versions/ 配下の生成ファイルを確認したのち:
uv run alembic upgrade head
```

### ステップ5 — テストデータの投入

```bash
uv run python scripts/seed_db.py
```

3 つのロケールにまたがって **決定的なテストユーザー 38 人と 79 のエージェント**を作成します:

| ロケール | ユーザー | 地域 | サンプル |
|---|---|---|---|
| `en` | 1–20 (+ Alice/Bob/Carol アンカー) | Brisbane, AU | Alice (Jazz Lover)、Bob (Vinyl Collector)、Carol (Gamer) |
| `ko` | 21–28 (Jiho/Suah ペア含む) | Seoul / Sunnybank | Jiho (インディー音楽プロデューサー)、Suah (レコードショップオーナー) |
| `ja` | 31–38 | Osaka, JP | 田中太郎、渡辺健太 |

シードは常に 3 つのロケール全てを投入します — ステップ 6 の `--lang` フラグはフロントエンドのデフォルト UI 言語と地図中心を変えるだけで、投入されるデータには影響しません。UI ロケールに関わらず地域を跨いだマッチングが可能です。

Alice (`11111111-1111-1111-1111-111111111111`)、Bob (`22222222-…2222`)、Carol (`33333333-…3333`) は決定論的な API テストのため、再シードしても固定 UUID を維持します。

### ステップ6 — サービスの起動

`scripts/` フォルダには全ての運用ヘルパーがあります。日常的に使う 2 つ:

#### `scripts/start_all.sh` — フルスタック起動

```bash
./scripts/start_all.sh                              # バックエンドのみ (:8001–:8005 の 6 サービス + ワーカー)
./scripts/start_all.sh --with-frontend              # + :3000 で Next.js 開発サーバー (英語 UI、Brisbane 地図)
./scripts/start_all.sh --with-frontend --lang ko    # + 韓国語 UI、Seoul 地図中心
./scripts/start_all.sh --with-frontend --lang ja    # + 日本語 UI、Osaka 地図中心
```

動作:
1. ポート 8001–8005、3000 の古いプロセスを kill。
2. Redis ストリームとコンシューマーグループをクリア (前回の停滞タスクが混入しないよう)。
3. 起動: matching (`:8001`)、gateway (`:8002`)、orchestrator (`:8003`)、wallet (`:8004`)、visit (`:8005`)、worker (バックグラウンド)。
4. `--with-frontend` 指定時: `frontend/` で `npm run dev` を実行 (`NEXT_PUBLIC_DEFAULT_LOCALE` を `--lang` の値に設定)。

ログは `/tmp/islume-{matching,orchestrator,gateway,wallet,visit,worker,frontend}.log` に出力されます。

#### `scripts/stop_all.sh` — スタック停止

```bash
./scripts/stop_all.sh
```

動作:
1. `/tmp/islume-pids` から PID を読み取り各サービスを kill。
2. ポート 8001–8005、3000 に残ったプロセスを掃除。
3. 名前で残った `services/worker/main.py` プロセスを kill。
4. **Postgres と Redis のコンテナはそのまま残します。** これらも止めるには: `docker compose down`。

### ステップ7 — エンドツーエンドテストで動作確認

サービスが稼働中でデータも投入済みなら、テストを 1 つ選んで実行:

#### 英語 (Alice ↔ Bob)
```bash
uv run python scripts/run_orchestrator_e2e.py
```
Alice (Jazz Lover) と Bob (Vinyl Collector) の 6 ターンセッション。セッション UUID を出力し、ワーカーが自動でタスクを拾います。

ライブ表示: ブラウザで `http://localhost:8002` を開き UUID を貼り付けて **Connect** をクリック。フロントエンドを起動済みなら `http://localhost:3000` でも可。

#### 韓国語 (Jiho ↔ Suah)
```bash
uv run python scripts/run_orchestrator_e2e_ko.py
```
ユーザー 21 と 22 — エージェントが `boundaries.language="ko"` を持つため、ワーカーは韓国語でシステムプロンプトを生成します。

#### 日本語 (田中 ↔ 渡辺)
```bash
uv run python scripts/run_orchestrator_e2e_ja.py
```
ユーザー 31 と 35 (大阪ペア)、`boundaries.language="ja"`。

#### ファンアウト — 1 人 vs N 人を同時並行
```bash
uv run python scripts/run_orchestrator_fanout_e2e.py --partners 5 --max-turns 4
```
Alice から N 人の異なるパートナーへ向かう N 個の `MatchSession` を並列作成し、全セッションが `status=completed` になるまで Postgres をポーリング。ワーカープールの負荷テストとコンシューマーグループの公平性検証に有用。

#### スタンドアロンスモークテスト (オーケストレーター不要)
```bash
uv run python scripts/smoke_test_chat.py
```
Alice と Bob の 5 ターン会話を単一プロセスで実行し、トークン/コスト要約を出力。Redis やワーカーを介さずに LLM 資格情報と `shared/llm.py` の動作確認に最適。

#### バータリングプラグインの E2E
```bash
uv run python scripts/run_bartering_e2e.py
```
Alice (売り手) + Bob (買い手) に `bartering` インテントプラグインを接続し、`deal_finalized` イベントまたはオーナー承認ハンドオフまでセッションストリームを観察。インテントプラグイン契約のエンドツーエンドのデモ。

### 自分のユーザーとエージェントを追加する

テストデータの真実の源はシードスクリプト (`scripts/seed_db.py`) です。

**手早い方法 — `seed_db.py` に追記:**
1. 新しいユーザーインデックス (例: `39`) を選び、ファイル冒頭の `USERS` リストにタプルを追記:
   `(_uuid(39), "名前", "email", "gender", age, "職業", "地区", isl_balance, allow_visit, chatting_enabled, "tier", "model")`。
2. `USER_LOCALES` でユーザーのロケールを設定: `39: "ja"` (または `"en"` / `"ko"`)。
3. 座標 dict に新ユーザーの lat/lon 項目を追加。
4. `AGENTS` dict にユーザーインデックスをキーとして 1–3 個のエージェントを追加。
5. `uv run python scripts/seed_db.py` を再実行 (DB を `DELETE` してから再挿入するので、手作りのデータがあるならバックアップを取ること)。

**Agent.md のフォーマット:**

シードされた各エージェントは `agents/{user_uuid}/{slug}.md` という markdown ファイルにもエクスポートされます。これらはエクスポート専用のミラーで、ランタイムの真実の源は DB 行ですが、`shared/agent_md.py` のスキーマが正式な契約です:

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
  language: en-AU          # 'ko' または 'ja' にすると会話言語が切り替わる
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
i18n:                       # ワーカーが ko/ja ペルソナで使う翻訳
  ko: { name: "재즈 애호가", description: "재즈를 사랑하는 사람" }
  ja: { name: "ジャズ愛好家", description: "ジャズを愛する人" }
---

# 本文 — ワーカーがシステムメッセージとして注入する長文ペルソナプロンプト。
```

書いた Agent.md を検証:

```bash
uv run python scripts/validate_agent_md.py
```

`agents/` 配下の全ファイルをラウンドトリップでパースし、スキーマ違反があれば非 0 で終了。CI に適しています。

**会話言語は UI ではなくエージェント単位で決まります。** `boundaries.language` を `en-AU`、`ko`、`ja` のいずれかに設定すると、ワーカーがその言語でシステムプロンプトを書きます。フロントエンドの `--lang` フラグとは独立です。

### マルチエージェント会話のシミュレーションを作る

`scripts/run_orchestrator_fanout_e2e.py` が多重セッションの正規例です。自作するには:

1. `scripts/run_orchestrator_e2e.py` をテンプレートとしてコピー。
2. 単一の `POST /sessions` 呼び出しを並列バッチに置き換え:
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
3. (オプション) Postgres の `MatchSession.status` が全て `completed` になるまでポーリング、または各 `stream:session:{id}` を `XREAD` してライブターンイベントを受信。

オーケストレーターは **最初のターンだけ**キューに入れます。以降はワーカーがタスクハンドラ内で次のターンをキューに追加し自己永続化します。外部コーディネーターは不要 — 50 個のセッションを並列に起こしてもワーカープールがコンシューマーグループ経由で自動的に消化します。

### トラブルシューティング

| 症状 | 推定原因 | 対処 |
|---|---|---|
| `ModuleNotFoundError: No module named 'shared'` | editable install を忘れた | `uv pip install -e .` |
| `Bind for 0.0.0.0:5432 failed: port is already allocated` | ホスト 5432 に別の Postgres | もう一方 (Langfuse セルフホストが多い) を停止、または `docker-compose.yml` のホストポートを変更 (`.env` の URL も合わせる) |
| `Bind for 0.0.0.0:6379 failed` | Redis に同じ問題 | 同じ対処 |
| 起動時に `BUSYGROUP` でクラッシュ | 既存のコンシューマーグループあり — 通常無害 (ワーカーが swallow) | 続くようなら: `uv run python scripts/reset_redis_streams.py` |
| ゲートウェイにターンが届かない | ワーカー未起動、または PEL でタスク stuck | `/tmp/islume-worker.log` を確認、`reset_redis_streams.py` でリセットしワーカー再起動 |
| LLM が 401 を返す | API キーが欠落または誤り | `.env` のキーが呼び出すプロバイダーと一致するか確認 |
| `npm install` が新パッケージで失敗 | グローバル設定が 7 日間の最小リリース経過を強制 | 古いバージョンをピン、ゲートを無効化しないこと |
| ページ再読込でセッションのターンが消える | ブラウザの古い `sessionId` | ハードリロード — ゲートウェイが `stream:session:{id}` から再生 |
| `start_all.sh` で `Permission denied` | 実行権限なし | `chmod +x scripts/start_all.sh scripts/stop_all.sh` |

**問題が起きたら最初に見る場所:**
1. `/tmp/islume-<service>.log` — `start_all.sh` で起動した全サービスがここに書き込みます。
2. `docker compose logs postgres redis` — インフラ系の問題用。
3. `http://localhost:5540` の Redis Insight — `stream:llm_tasks` (ペンディングエントリ、コンシューマーラグ) と `stream:session:{id}` (ターンイベント) を検査。
4. `uv run python scripts/check_infra.py` — Postgres と Redis の到達性を 5 秒以内に確認。

### 便利な Tips

- **テスト実行間のリセット**: `./scripts/stop_all.sh && ./scripts/start_all.sh` で通常十分 — `start_all.sh` が起動時に Redis ストリームをクリアします。DB を完全リセットする場合: `docker compose down -v && docker compose up -d && uv run alembic upgrade head && uv run python scripts/seed_db.py`。
- **ブラウザなしでセッションをライブ視聴**: `docker exec -it islume-redis redis-cli XREAD COUNT 100 BLOCK 0 STREAMS stream:session:<uuid> 0`。
- **タスクキューの検査**: `docker exec -it islume-redis redis-cli XINFO GROUPS stream:llm_tasks` — ペンディング数とコンシューマーラグ。
- **コスト意識**: Claude Sonnet 4.5 で 1 ターン ≈ $0.002、6 ターンセッション ≈ $0.015。素早い反復には `claude-haiku-4-5` や `gemini-2.0-flash` を使うと安価。
- **リロード動作**: バックエンドサービスは `uvicorn --reload` で動くので `.py` を保存するとそのサービスが再起動。ワーカーは例外 — `services/worker/` を変更したら手動で再起動。Next.js は自動ホットリロード。

## ステータス

**MVP完了** — ローカル開発環境が完全に動作します。エンドツーエンドのフローを検証済み:
- ✅ マップ + マッチングAPI (近接度 + ペルソナ類似度)
- ✅ エージェントオーケストレーター (セッションライフサイクル)
- ✅ LLMワーカープール (自己永続化キューを持つRedis Streamsコンシューマー)
- ✅ WebSocketゲートウェイ (Redis Streams経由の耐久イベントストリーミング)
- ✅ Postgres永続化 (セッション、ターン、エージェント)
- ✅ ISLウォレットサービス (台帳、送金、暗号署名)
- ✅ 島訪問サービス (手続き的に生成される島、アバター探索、DMチャット)

## アーキテクチャ概要

7つのサービスがRedis (タスクキュー、イベントストリーム) とPostgres (永続状態) を通じて接続されます:

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

詳細なコンポーネント分析は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照してください。

## 技術スタック

- **バックエンド**: Python 3.12, FastAPI, asyncio
- **データベース**: PostgreSQL 16 + SQLAlchemy 2.0 (async) + Alembic
- **メッセージキュー**: Redis 7 Streams (耐久性、コンシューマーグループ)
- **ステートストア**: Redis 7 (位置情報はGEO、セッションはHash)
- **LLM**: マルチプロバイダー (Anthropic Claude, OpenAI, Gemini, Ollama) — 環境変数で設定
- **ホスティング**: Railway (本番ターゲット)
- **ローカルインフラ**: Docker Compose
- **パッケージ管理**: uv

## クイックスタート

### 前提条件

- Ubuntu 24.04 (または類似のLinux)
- Docker + Docker Compose
- uv (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- LLM APIキーを少なくとも1つ (Anthropic, OpenAI, Gemini) — またはローカルモデル用のOllama

### セットアップ

```bash
# クローンしてプロジェクトに移動
cd ~/islume

# 依存関係のインストールとパッケージのセットアップ
uv pip install -e .

# 環境変数の設定
cp .env.example .env  # 存在する場合、なければ .env を直接編集
# .env にLLM APIキーを設定 (少なくとも1つ必須):
# ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, または OLLAMA_BASE_URL

# インフラの起動
docker compose up -d

# RedisとPostgresが正常か確認
docker compose ps

# データベースマイグレーションの実行
uv run alembic upgrade head

# テストデータのシード (20ユーザー、60エージェント)
uv run python scripts/seed_db.py

# 動作確認
uv run python scripts/check_infra.py
```

### サービスの実行

すべてを一度に実行 (推奨):

```bash
./scripts/start_all.sh          # 古いポートをクリーンアップ、Redisを初期化、6つのサービスをすべて起動
./scripts/stop_all.sh           # すべてのサービスを停止
```

または6つの個別ターミナルで (`tmux` や `zellij` の使用を推奨):

**ターミナル1 — マップ + マッチングAPI:**
```bash
uv run uvicorn services.matching.main:app --reload --port 8001
```

**ターミナル2 — オーケストレーター:**
```bash
uv run uvicorn services.orchestrator.main:app --reload --port 8003
```

**ターミナル3 — LLMワーカー:**
```bash
uv run python services/worker/main.py
```

**ターミナル4 — WebSocketゲートウェイ:**
```bash
uv run uvicorn services.gateway.main:app --reload --port 8002
```

**ターミナル5 — ウォレットサービス:**
```bash
uv run uvicorn services.wallet.main:app --reload --port 8004
```

**ターミナル6 — 訪問サービス:**
```bash
uv run uvicorn services.visit.main:app --reload --port 8005
```

### エンドツーエンドテストの実行

7番目のターミナルで:

```bash
uv run python scripts/run_orchestrator_e2e.py
```

Alice (Jazz Lover) とBob (Vinyl Collector) の間のマッチセッションを作成し、最初のターンをキューに入れ、セッションIDを出力します。

ブラウザで `http://localhost:8002` を開き、セッションIDを貼り付けて "Connect" をクリックすると、会話がリアルタイムで展開される様子を見ることができます。

## マッチングAPIの直接テスト

```bash
# Aliceの位置を更新 (Brisbane CBD)
curl -X POST http://localhost:8001/islands/11111111-1111-1111-1111-111111111111/position \
  -H "Content-Type: application/json" \
  -d '{"longitude": 153.0281, "latitude": -27.4679}'

# Bobの位置を更新 (約200m離れた地点)
curl -X POST http://localhost:8001/islands/22222222-2222-2222-2222-222222222222/position \
  -H "Content-Type: application/json" \
  -d '{"longitude": 153.0301, "latitude": -27.4664}'

# Aliceのマッチを検索
curl -X POST http://localhost:8001/matches/find \
  -H "Content-Type: application/json" \
  -d '{"user_id": "11111111-1111-1111-1111-111111111111", "radius_m": 500, "min_similarity": 0.3}'
```

## プロジェクト構造

```
islume/
├── docker-compose.yml          # ローカルインフラ
├── pyproject.toml              # uv ワークスペース + パッケージ設定
├── alembic.ini                 # データベースマイグレーション設定
├── migrations/                 # Alembic マイグレーションスクリプト
├── shared/                     # サービス間で共有するモジュール
│   ├── config.py               # pydantic-settings 環境ローダー
│   ├── db.py                   # 非同期 SQLAlchemy エンジン + セッション
│   ├── redis_client.py         # Redis 非同期クライアントファクトリ
│   ├── llm.py                  # マルチプロバイダーLLMクライアント
│   ├── messages.py             # Pydantic メッセージスキーマ
│   └── models.py               # SQLAlchemy ORM モデル
├── services/
│   ├── matching/               # マップ + マッチングAPI
│   │   ├── main.py             # FastAPI アプリ
│   │   ├── geo.py              # Redis GEO ヘルパー
│   │   ├── matcher.py          # 近接度 + 類似度マッチングロジック
│   │   ├── similarity.py       # ジャッカード類似度
│   │   └── schemas.py          # Pydantic リクエスト/レスポンスモデル
│   ├── orchestrator/           # セッション作成 + タスクキュー投入
│   │   └── main.py
│   ├── worker/                 # LLMワーカープール
│   │   └── main.py
│   ├── gateway/                # WebSocketゲートウェイ
│   │   └── main.py
│   ├── wallet/                 # ISL ウォレット + 台帳 + 送金
│   │   ├── main.py
│   │   └── schemas.py
│   └── visit/                  # 島訪問 + DM チャット
│       ├── main.py
│       ├── api.py
│       └── schemas.py
├── scripts/
│   ├── check_infra.py          # Redis + Postgres 接続確認
│   ├── seed_db.py              # テストユーザーとエージェントの投入
│   ├── run_orchestrator_e2e.py # エンドツーエンドテストのトリガー
│   ├── start_all.sh            # 6つのサービスをすべて起動 (起動時にRedisをクリア)
│   ├── stop_all.sh             # すべてのサービスを停止しポートを解放
│   └── smoke_test_chat.py      # 簡易チャットスモークテスト
└── frontend/                   # Next.js 16 + React 19 + TypeScript クライアント
    ├── package.json            # npm 依存関係 + スクリプト (dev, build, lint, knip)
    ├── next.config.ts          # Next.js 設定
    ├── app/                    # App Router ページ + レイアウト
    ├── components/             # React コンポーネント (map, panels, session, chat, island-explore)
    ├── hooks/                  # カスタムフック (useIslands, useMatch, useProfile, useVisit, …)
    ├── stores/                 # Zustand 状態 (appStore.ts)
    ├── lib/                    # API クライアント、型、定数、WS ヘルパー、タイルマップ、i18n (en/ko/ja)
    └── public/                 # 静的アセット (スプライト、アイコン)
```

