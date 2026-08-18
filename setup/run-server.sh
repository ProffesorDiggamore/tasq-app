#!/bin/bash
# Wrapper launchd points at. Exists because launchd starts processes with a
# nearly empty environment: no shell profile, no nvm, no Homebrew on PATH.
set -euo pipefail

APP_DIR="${APEX_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$APP_DIR"

mkdir -p logs data backups

if [ ! -f .env.local ]; then
  echo "[apex] .env.local is missing — copy .env.example and fill it in." >&2
  exit 78 # EX_CONFIG
fi

if [ ! -d .next ]; then
  echo "[apex] no build found — run 'npm run build' (or setup/deploy.sh) first." >&2
  exit 78
fi

echo "[apex] starting $(date '+%Y-%m-%d %H:%M:%S') from $APP_DIR"
exec npm run start
