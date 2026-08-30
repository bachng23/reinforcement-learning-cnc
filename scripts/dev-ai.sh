#!/usr/bin/env bash
# Start the CNC research AI API directly from source.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AI="$ROOT/ai_services"
LOG_DIR="$AI/logs"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[ai]${NC} $*"; }
warn() { echo -e "${YELLOW}[ai]${NC} $*"; }

PIDS=()
cleanup() {
  warn "Shutting down AI source processes."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

mkdir -p "$LOG_DIR"
cd "$AI"

if [ ! -d "$AI/.venv" ]; then
  log "Creating uv environment."
  uv sync
fi

log "Starting CNC research AI API on http://localhost:8001."
uv run uvicorn main:app --host 0.0.0.0 --port 8001 --reload \
  > "$LOG_DIR/api.log" 2>&1 &
PIDS+=($!)

echo ""
log "AI service is running. Log:"
echo "  $LOG_DIR/api.log"
echo ""
warn "Press Ctrl+C to stop AI services."

tail -f "$LOG_DIR/api.log" &
PIDS+=($!)

wait
