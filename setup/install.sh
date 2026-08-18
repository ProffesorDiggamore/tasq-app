#!/bin/bash
# Installs the Apex Board server and nightly backup as launchd jobs.
#
#   sudo setup/install.sh
#
# Re-running is safe: it replaces the installed jobs with the current templates.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: sudo setup/install.sh" >&2
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="${SUDO_USER:-$(stat -f '%Su' "$APP_DIR")}"

# launchd has no PATH worth speaking of, so the node location is resolved here,
# as the real user, and baked into the plist.
NODE_BIN="$(sudo -u "$RUN_USER" -i bash -lc 'command -v node' || true)"
if [ -z "$NODE_BIN" ]; then
  echo "Could not find node for user $RUN_USER. Install Node 20+ and try again." >&2
  exit 1
fi
NODE_DIR="$(dirname "$NODE_BIN")"

echo "App:  $APP_DIR"
echo "User: $RUN_USER"
echo "Node: $NODE_BIN"

case "$APP_DIR" in
  */Documents/*|*/Desktop/*|*/Downloads/*)
    echo
    echo "WARNING: $APP_DIR is inside a TCC-protected folder."
    echo "A LaunchDaemon cannot read Documents, Desktop or Downloads, and the"
    echo "server will fail with EPERM. Move the app somewhere like"
    echo "/Users/Shared/apex-board and re-run this script."
    echo
    read -r -p "Continue anyway? [y/N] " reply
    [ "$reply" = "y" ] || exit 1
    ;;
esac

install -d -o "$RUN_USER" -g staff "$APP_DIR/logs" "$APP_DIR/data" "$APP_DIR/backups"
chmod +x "$APP_DIR"/setup/*.sh

render() {
  sed -e "s|__APP_DIR__|$APP_DIR|g" \
      -e "s|__RUN_USER__|$RUN_USER|g" \
      -e "s|__NODE_DIR__|$NODE_DIR|g" \
      "$1" > "$2"
  chown root:wheel "$2"
  chmod 644 "$2"
}

for job in server backup; do
  LABEL="com.apexboard.$job"
  TARGET="/Library/LaunchDaemons/$LABEL.plist"

  # bootout first so a re-run replaces cleanly rather than erroring.
  launchctl bootout "system/$LABEL" 2>/dev/null || true
  render "$APP_DIR/setup/$LABEL.plist" "$TARGET"
  launchctl bootstrap system "$TARGET"
  launchctl enable "system/$LABEL"
  echo "installed $LABEL"
done

launchctl kickstart -k system/com.apexboard.server

echo
echo "Done. Check it came up:"
echo "  launchctl print system/com.apexboard.server | head -20"
echo "  tail -f $APP_DIR/logs/server.log"
