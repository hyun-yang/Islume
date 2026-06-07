#!/bin/bash
# Start the entire Islume stack: infrastructure → migrations → seed → services → frontend
# Usage:
#   ./scripts/start_all.sh                            # Backend only
#   ./scripts/start_all.sh --with-frontend            # Backend + frontend dev server
#   ./scripts/start_all.sh --with-frontend --lang ko  # Frontend defaults to Korean UI + Seoul map
#
#   --lang <en|ko|ja>  Sets the frontend's default UI language + initial map focus.
#                      All three regions (Brisbane/Seoul/Osaka) are ALWAYS seeded;
#                      --lang only affects the frontend, not the seeded data.

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[islume]${NC} $1"; }
warn() { echo -e "${YELLOW}[islume]${NC} $1"; }
fail() { echo -e "${RED}[islume]${NC} $1"; exit 1; }

# --- Parse arguments ---
WITH_FRONTEND=0
LANG_VERSION="en"
while [ $# -gt 0 ]; do
  case "$1" in
    --with-frontend)
      WITH_FRONTEND=1
      shift
      ;;
    --lang)
      LANG_VERSION="${2:-en}"
      shift
      shift || true
      ;;
    --lang=*)
      LANG_VERSION="${1#*=}"
      shift
      ;;
    *)
      warn "Unknown option: $1"
      shift
      ;;
  esac
done
case "$LANG_VERSION" in
  en|ko|ja) ;;
  *) fail "Invalid --lang '$LANG_VERSION' (expected en, ko, or ja)" ;;
esac

# --- Kill any existing services on our ports ---
kill_port() {
  local port=$1
  local pid
  pid=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    warn "Killing process on port $port (pid $pid)"
    kill "$pid" 2>/dev/null || true
    sleep 0.5
  fi
}

log "Cleaning up existing services..."
kill_port 8001
kill_port 8002
kill_port 8003
kill_port 8004
kill_port 8005
# Kill any running workers
pkill -f "services/worker/main.py" 2>/dev/null || true

# --- 1. Infrastructure (Docker Compose) ---
log "Starting Docker Compose (Postgres + Redis)..."
docker compose up -d

log "Waiting for Postgres to be healthy..."
for i in $(seq 1 30); do
  if docker exec islume-postgres pg_isready -U islume -d islume_dev -q 2>/dev/null; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    fail "Postgres did not become ready in 30 seconds"
  fi
  sleep 1
done
log "Postgres is ready."

log "Waiting for Redis to be healthy..."
for i in $(seq 1 30); do
  if docker exec islume-redis redis-cli ping 2>/dev/null | grep -q PONG; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    fail "Redis did not become ready in 30 seconds"
  fi
  sleep 1
done
log "Redis is ready."

# --- 2. Database migrations ---
log "Running Alembic migrations..."
uv run alembic upgrade head

# --- 3. Seed data ---
log "Seeding test data..."
uv run python scripts/seed_db.py

# --- 4. Clear stale Redis streams (keep geo:islands — seeded positions) ---
log "Clearing stale Redis streams..."
docker exec islume-redis redis-cli DEL stream:llm_tasks >/dev/null 2>&1 || true

# --- 5. Start backend services ---
PIDS=()

log "Starting Matching API on :8001..."
uv run uvicorn services.matching.main:app --port 8001 > /tmp/islume-matching.log 2>&1 &
PIDS+=($!)

log "Starting Orchestrator on :8003..."
uv run uvicorn services.orchestrator.main:app --port 8003 > /tmp/islume-orchestrator.log 2>&1 &
PIDS+=($!)

log "Starting Gateway on :8002..."
uv run uvicorn services.gateway.main:app --port 8002 > /tmp/islume-gateway.log 2>&1 &
PIDS+=($!)

log "Starting Wallet Service on :8004..."
uv run uvicorn services.wallet.main:app --port 8004 > /tmp/islume-wallet.log 2>&1 &
PIDS+=($!)

log "Starting Visit Service on :8005..."
uv run uvicorn services.visit.main:app --port 8005 > /tmp/islume-visit.log 2>&1 &
PIDS+=($!)

log "Starting LLM Worker..."
uv run python services/worker/main.py > /tmp/islume-worker.log 2>&1 &
PIDS+=($!)

# Wait for HTTP services to be ready
log "Waiting for services to start..."
for port in 8001 8002 8003 8004 8005; do
  for i in $(seq 1 15); do
    if curl -sf "http://localhost:$port/health" >/dev/null 2>&1; then
      break
    fi
    if [ "$i" -eq 15 ]; then
      fail "Service on port $port did not start. Check /tmp/islume-*.log"
    fi
    sleep 1
  done
done
log "All backend services are running."

# --- 6. Optional: Frontend dev server ---
if [ "$WITH_FRONTEND" = "1" ]; then
  log "Starting frontend dev server on :3000 (default UI locale: $LANG_VERSION)..."
  cd "$PROJECT_DIR/frontend"
  NEXT_PUBLIC_DEFAULT_LOCALE="$LANG_VERSION" npm run dev > /tmp/islume-frontend.log 2>&1 &
  PIDS+=($!)

  for i in $(seq 1 20); do
    if curl -sf "http://localhost:3000" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  log "Frontend is running at http://localhost:3000"
fi

# --- Summary ---
echo ""
log "=== Islume is running ==="
log "  Matching API:  http://localhost:8001"
log "  Gateway:       http://localhost:8002"
log "  Orchestrator:  http://localhost:8003"
log "  Wallet:        http://localhost:8004"
log "  Visit:         http://localhost:8005"
log "  Worker:        running (background)"
if [ "$WITH_FRONTEND" = "1" ]; then
  log "  Frontend:      http://localhost:3000  (default UI locale: $LANG_VERSION)"
fi
log ""
log "  Logs: /tmp/islume-{matching,orchestrator,gateway,wallet,visit,worker,frontend}.log"
log "  Redis Insight: http://localhost:5540"
log ""
log "  PIDs: ${PIDS[*]}"
log "  Stop all: kill ${PIDS[*]}"
echo ""

# Write PIDs to file for easy cleanup
echo "${PIDS[*]}" > /tmp/islume-pids

# Wait for all background processes
wait
