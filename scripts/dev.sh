#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

export PORT="${PORT:-8787}"
export STATIC_ROOT="$(pwd)/public"

# Prefer system caddy, then project-local .bin/caddy (auto-downloaded below).
CADDY=""
if command -v caddy >/dev/null 2>&1; then
  CADDY=caddy
elif [[ -x .bin/caddy ]]; then
  CADDY=.bin/caddy
else
  mkdir -p .bin
  echo "Downloading Caddy..."
  curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=amd64" -o .bin/caddy
  chmod +x .bin/caddy
  CADDY=.bin/caddy
fi

if [[ ! -f public/index.html ]]; then
  echo "public/index.html is missing. Run: npm run build" >&2
  exit 1
fi

node scripts/link-static-assets.mjs

# Avoid duplicate listeners on the same port (causes flaky asset responses).
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
elif command -v lsof >/dev/null 2>&1; then
  lsof -ti:"${PORT}" | xargs -r kill 2>/dev/null || true
fi
pkill -f "caddy run --config $(pwd)/Caddyfile" 2>/dev/null || true
pkill -f "wrangler dev" 2>/dev/null || true
pkill -f workerd 2>/dev/null || true
sleep 0.5

echo "Serving ${STATIC_ROOT} at http://localhost:${PORT}"
echo "Rebuild after edits: npm run build"
echo "If styles look missing, hard-refresh (Ctrl+Shift+R) to clear old cached redirects."
exec "$CADDY" run --config Caddyfile --adapter caddyfile
