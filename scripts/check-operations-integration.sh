#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

: "${TEST_DATABASE_URL:?Pass an explicit URL for a dedicated database ending in _test or _ci}"
: "${MIGRATION_BASE_SHA:?Pass the exact PR base SHA (or pre-push SHA)}"
for tool in node npm uv docker; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done
node -e '
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  if (major !== 22 || minor < 22 || (minor === 22 && patch < 2)) {
    throw new Error("Operations gate requires Node 22.22.2+ in the Node 22 release line");
  }
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !/_(test|ci)$/.test(decodeURIComponent(url.pathname))) {
    throw new Error("TEST_DATABASE_URL must name a dedicated PostgreSQL database ending in _test or _ci");
  }
'

# Never inherit a development database, signing key or factory allowlist.
export DATABASE_URL="$TEST_DATABASE_URL"
export JWT_SECRET='operations-ci-test-only-secret-at-least-32-characters'
export OPERATIONS_FACTORY_ACCESS='{}'
export NEXT_TELEMETRY_DISABLED=1
# Keep sync/run on the same 3.12 interpreter rather than re-reading a patch pin.
export UV_PYTHON=3.12
OPERATIONS_SCHEMA_JOURNAL="${OPERATIONS_SCHEMA_JOURNAL:-$(mktemp "${TMPDIR:-/tmp}/operations-schema-journal.XXXXXX")}"
export OPERATIONS_SCHEMA_JOURNAL
printf '[operations gate] Schema cleanup journal: %s\n' "$OPERATIONS_SCHEMA_JOURNAL"

cleanup() {
  local status=$?
  trap - EXIT
  node backend/tests/integration/run-integration-tests.js --cleanup || status=1
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

stage() {
  if [[ "${GITHUB_ACTIONS:-}" == 'true' ]]; then
    echo "::group::$1"
  else
    printf '\n[operations gate] %s\n' "$1"
  fi
  shift
  "$@"
  if [[ "${GITHUB_ACTIONS:-}" == 'true' ]]; then echo '::endgroup::'; fi
}

stage 'Existing migration history is immutable' node scripts/check-migration-history.js
stage 'Install locked backend dependencies' npm ci --include=dev --prefix backend
stage 'Fresh migrations and upgrade from base SHA' node scripts/check-migration-paths.js
stage 'Install locked frontend dependencies' npm ci --include=dev --prefix frontend
stage 'Install locked Python dependencies' uv sync --frozen --group dev --python 3.12 --project ai_services
export OPERATIONS_PYTHON
OPERATIONS_PYTHON="$(uv run --no-sync --project ai_services python -c 'import sys; print(sys.executable)')"

stage 'Generate Prisma client' npm --prefix backend run prisma:generate
stage 'Canonical contracts and generated client types' uv run --frozen --project ai_services python scripts/check-contracts.py
stage 'Backend unit tests' env NODE_ENV=test npm --prefix backend test -- --runInBand
# Each runner migrates its own fresh schema, and cleans it in finally even on failure.
stage 'PostgreSQL integration' npm --prefix backend run test:integration
stage 'Frontend generated types' npm --prefix frontend run contracts:check
stage 'Frontend typecheck' npm --prefix frontend run typecheck
stage 'Frontend mock/client and UI tests' npm --prefix frontend test -- --run
stage 'Full snapshot flow' npm --prefix backend run test:operations-flow
stage 'Frontend production build' env NODE_ENV=production npm --prefix frontend run build
stage 'Backend production image and validator smoke check' docker build -f backend/Dockerfile -t cnc-backend:test .
