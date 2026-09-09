#!/usr/bin/env bash
# Verify the local source-native development stack.

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAILURES=0

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

pass() { echo -e "${GREEN}[ok]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
fail() {
  echo -e "${RED}[fail]${NC} $*"
  FAILURES=$((FAILURES + 1))
}

check_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    pass "command available: $1"
  else
    fail "missing command: $1"
  fi
}

check_tcp() {
  local label="$1"
  local host="$2"
  local port="$3"
  if nc -z "$host" "$port" >/dev/null 2>&1; then
    pass "$label reachable at $host:$port"
  else
    fail "$label not reachable at $host:$port"
  fi
}

check_http() {
  local label="$1"
  local url="$2"
  if curl -fsS "$url" >/dev/null 2>&1; then
    pass "$label healthy: $url"
  else
    fail "$label failed: $url"
  fi
}

echo "Checking local dev dependencies..."
check_cmd curl
check_cmd nc
check_cmd node
check_cmd npm
check_cmd uv

echo ""
echo "Checking Docker infra config..."
if command -v docker >/dev/null 2>&1; then
  if docker compose -f "$ROOT/docker-compose.yml" config --quiet >/dev/null 2>&1; then
    pass "docker-compose.yml is valid"
  else
    fail "docker-compose.yml is invalid"
  fi
else
  warn "Docker is not installed; using a native PostgreSQL service."
fi

echo ""
echo "Checking infra ports..."
check_tcp "Postgres" localhost 5432

echo ""
echo "Checking source services..."
check_http "Backend" http://localhost:5000/api/health
check_http "AI API" http://localhost:8001/health

if curl -fsS http://localhost:3000 >/dev/null 2>&1; then
  pass "Frontend reachable: http://localhost:3000"
else
  fail "Frontend not reachable: http://localhost:3000"
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  pass "Local dev stack checks passed."
  exit 0
fi

echo -e "${RED}[fail]${NC} $FAILURES check(s) failed."
exit 1
