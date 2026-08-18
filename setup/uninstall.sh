#!/bin/bash
#
# Removes the Apex Board background jobs and public access.
#
#   bash setup/uninstall.sh
#
# Your data is NOT touched: data/apex.db and backups/ are left exactly where
# they are. Re-run setup/bootstrap.sh to bring the board back with them intact.
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=4744

if [ -t 1 ]; then BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'; else BOLD=''; DIM=''; RESET=''; fi

echo "${BOLD}Removing Apex Board's background jobs${RESET}"
echo "${DIM}Your database and backups stay put.${RESET}"
echo

for job in server backup; do
  LABEL="com.apexboard.$job"
  if launchctl print "system/$LABEL" >/dev/null 2>&1; then
    sudo launchctl bootout "system/$LABEL" 2>/dev/null || true
    echo "  stopped $LABEL"
  fi
  if [ -f "/Library/LaunchDaemons/$LABEL.plist" ]; then
    sudo rm -f "/Library/LaunchDaemons/$LABEL.plist"
    echo "  removed $LABEL.plist"
  fi
done

if command -v tailscale >/dev/null 2>&1 && tailscale funnel status 2>/dev/null | grep -q "$PORT"; then
  sudo tailscale funnel off >/dev/null 2>&1 || sudo tailscale funnel "$PORT" off >/dev/null 2>&1 || true
  echo "  turned off public access"
fi

echo
echo "Done. Still on disk:"
echo "  database  $APP_DIR/data/apex.db"
echo "  backups   $APP_DIR/backups/"
echo
echo "Sleep settings were left as they are. To let this Mac sleep again:"
echo "  sudo pmset -a sleep 10 disablesleep 0"
