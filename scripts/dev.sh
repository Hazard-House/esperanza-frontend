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

node scripts/link-static-assets.mjs

# Avoid duplicate Caddy listeners on the same port (causes flaky asset responses).
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
elif command -v lsof >/dev/null 2>&1; then
  lsof -ti:"${PORT}" | xargs -r kill 2>/dev/null || true
fi
pkill -f "caddy run --config $(pwd)/Caddyfile" 2>/dev/null || true
sleep 0.5

echo "Serving ${STATIC_ROOT} at http://localhost:${PORT}"
echo "Rebuild after edits: npm run build"
echo "If styles look missing, hard-refresh (Ctrl+Shift+R) to clear old cached redirects."
exec caddy run --config Caddyfile --adapter caddyfile
