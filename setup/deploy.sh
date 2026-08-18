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

if [ -d .git ] && git remote | grep -q .; then
  echo "==> Pulling"
  git pull --ff-only
elif [ -d .git ]; then
  # A copied-over folder is a git checkout with no remote to pull from. That is
  # a normal way to run this, so it is not an error — just build what is here.
  echo "==> No git remote; building what is already here"
else
  echo "==> Not a git checkout; building what is already here"
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
