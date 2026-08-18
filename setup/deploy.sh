#!/bin/bash
# One command to update the board: pull, install, build, restart.
#
# Builds *before* restarting, so a build that fails leaves the running board
# untouched instead of taking the shop down.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

echo "==> Backing up the database first"
setup/backup.sh || echo "    (backup skipped)"

if [ -d .git ]; then
  echo "==> Pulling"
  git pull --ff-only
else
  echo "==> Not a git checkout; skipping pull"
fi

echo "==> Installing dependencies"
npm ci --omit=dev --include=dev

echo "==> Building"
npm run build

echo "==> Checking the logic still holds"
npm run verify

echo "==> Restarting the service"
if launchctl print system/com.apexboard.server >/dev/null 2>&1; then
  sudo launchctl kickstart -k system/com.apexboard.server
  echo "    restarted"
else
  echo "    service is not installed — run setup/install.sh"
fi

echo "==> Done"
