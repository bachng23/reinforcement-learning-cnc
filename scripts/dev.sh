#!/usr/bin/env bash
# Compatibility wrapper for the source-native web dev loop.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

exec "$ROOT/scripts/dev-web.sh" "$@"
