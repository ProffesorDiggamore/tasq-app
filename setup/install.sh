#!/bin/bash
# Installs the Tasq server and nightly backup as launchd jobs.
#
#   sudo setup/install.sh
#
# Most people should run setup/bootstrap.sh instead, which does the whole
# machine — secrets, build, sleep settings, Tailscale — and calls this.
#
# Re-running is safe: it replaces the installed jobs with the current templates.
# Set TASQ_ASSUME_YES=1 to skip the one prompt (bootstrap.sh does this).
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
    echo "/Users/Shared/tasq and re-run this script."
    echo
    if [ "${TASQ_ASSUME_YES:-0}" = "1" ]; then
      echo "TASQ_ASSUME_YES is set — continuing anyway."
    else
      read -r -p "Continue anyway? [y/N] " reply
      [ "$reply" = "y" ] || exit 1
    fi
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
  LABEL="com.tasq.$job"
  TARGET="/Library/LaunchDaemons/$LABEL.plist"

  # bootout first so a re-run replaces cleanly rather than erroring.
  launchctl bootout "system/$LABEL" 2>/dev/null || true

  # bootout returns before the job is actually gone. Bootstrapping into a label
  # that is still unloading fails with "5: Input/output error", which is what a
  # second run of this script used to hit. Wait for it to really disappear.
  for _ in $(seq 1 50); do
    launchctl print "system/$LABEL" >/dev/null 2>&1 || break
    sleep 0.2
  done

  render "$APP_DIR/setup/$LABEL.plist" "$TARGET"

  # Even after the wait, launchd can briefly hold the label. Retry a few times
  # before giving up so a re-install is not a coin flip.
  bootstrapped=0
  for attempt in 1 2 3 4 5; do
    if launchctl bootstrap system "$TARGET" 2>/dev/null; then
      bootstrapped=1
      break
    fi
    [ "$attempt" -lt 5 ] && sleep 1
  done
  if [ "$bootstrapped" -ne 1 ]; then
    echo "Could not start $LABEL. Try:" >&2
    echo "  sudo launchctl bootout system/$LABEL" >&2
    echo "  sudo launchctl bootstrap system $TARGET" >&2
    exit 1
  fi

  launchctl enable "system/$LABEL"
  echo "installed $LABEL"
done

launchctl kickstart -k system/com.tasq.server

echo
echo "Done. Check it came up:"
echo "  launchctl print system/com.tasq.server | head -20"
echo "  tail -f $APP_DIR/logs/server.log"
