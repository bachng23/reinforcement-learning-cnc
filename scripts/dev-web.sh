#!/usr/bin/env bash
# Start backend and frontend directly from source for daily development.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[web]${NC} $*"; }
warn() { echo -e "${YELLOW}[web]${NC} $*"; }

PIDS=()
cleanup() {
  warn "Shutting down source web processes."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if [ ! -f "$BACKEND/.env" ]; then
  warn "backend/.env is missing. Creating it from backend/.env.example."
  cp "$BACKEND/.env.example" "$BACKEND/.env"
  warn "Review $BACKEND/.env if you use Tailscale or custom credentials."
fi

if [ ! -f "$FRONTEND/.env.local" ]; then
  warn "frontend/.env.local is missing. Creating it from frontend/.env.local.example."
  cp "$FRONTEND/.env.local.example" "$FRONTEND/.env.local"
fi

if [ ! -d "$BACKEND/node_modules" ]; then
  log "Installing backend dependencies."
  (cd "$BACKEND" && npm install)
fi

if [ ! -d "$FRONTEND/node_modules" ]; then
  log "Installing frontend dependencies."
  (cd "$FRONTEND" && npm install)
fi

log "Running Prisma generate."
(cd "$BACKEND" && npm run prisma:generate)

log "Starting backend on http://localhost:8080."
(cd "$BACKEND" && npm run dev) &
PIDS+=($!)

sleep 2

log "Starting the episode worker."
(cd "$BACKEND" && npm run worker:dev) &
PIDS+=($!)

log "Starting frontend on http://localhost:3000."
(cd "$FRONTEND" && npm run dev) &
PIDS+=($!)

echo ""
log "Source web stack is up:"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:8080"
echo "  Worker:   polling queued episodes"
echo ""
warn "Press Ctrl+C to stop backend, worker, and frontend."

wait
