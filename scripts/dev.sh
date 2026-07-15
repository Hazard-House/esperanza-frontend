#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

export PORT="${PORT:-8787}"
export STATIC_ROOT="$(pwd)/public"

if ! command -v caddy >/dev/null 2>&1; then
  echo "Caddy is required. Install: https://caddyserver.com/docs/install" >&2
  exit 1
fi

if [[ ! -f public/index.html ]]; then
  echo "public/index.html is missing. Run: npm run build" >&2
  exit 1
fi

echo "Serving ${STATIC_ROOT} at http://localhost:${PORT}"
echo "Rebuild after edits: npm run build"
exec caddy run --config Caddyfile --adapter caddyfile
