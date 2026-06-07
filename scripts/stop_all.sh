#!/bin/bash
# Stop all Islume services started by start_all.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log() { echo -e "${GREEN}[islume]${NC} $1"; }

# Kill PIDs from start_all.sh
if [ -f /tmp/islume-pids ]; then
  PIDS=$(cat /tmp/islume-pids)
  log "Killing services: $PIDS"
  kill $PIDS 2>/dev/null || true
  rm /tmp/islume-pids
fi

# Kill any remaining processes on our ports
for port in 8001 8002 8003 8004 8005 3000; do
  pid=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    log "Killing process on port $port (pid $pid)"
    kill "$pid" 2>/dev/null || true
  fi
done

# Kill any remaining workers
pkill -f "services/worker/main.py" 2>/dev/null || true

log "All services stopped."
log "Docker containers (Postgres/Redis) are still running."
log "To stop them too: docker compose down"
