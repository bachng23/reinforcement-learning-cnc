#!/usr/bin/env bash
# Start Docker infrastructure only. App services run from source.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[infra]${NC} $*"; }
warn() { echo -e "${YELLOW}[infra]${NC} $*"; }

if command -v docker >/dev/null 2>&1; then
  if [ ! -f "$ROOT/.env" ]; then
    warn "Root .env is missing. Creating it from .env.example with local-dev placeholders."
    cp "$ROOT/.env.example" "$ROOT/.env"
    warn "Review $ROOT/.env before using this outside local development."
  fi

  log "Starting PostgreSQL with Docker Compose."
  docker compose -f "$ROOT/docker-compose.yml" up -d
  echo ""
  docker compose -f "$ROOT/docker-compose.yml" ps
elif command -v brew >/dev/null 2>&1 && brew --prefix postgresql@16 >/dev/null 2>&1; then
  log "Starting PostgreSQL 16 with Homebrew Services."
  brew services start postgresql@16
else
  warn "PostgreSQL is unavailable. Install Docker or Homebrew postgresql@16."
  exit 1
fi

echo ""
log "Infrastructure endpoints:"
echo "  Postgres:  localhost:5432"
