#!/bin/bash
# Double-click this file in Finder to update the Tasq board.
#
# You need the new version from Landon: a folder called "Tasq-update" (or a
# "Tasq-update" zip) on the Desktop, in Downloads, or sitting next to this
# app. This script backs up your data first, installs the new version, checks
# it starts, and only then swaps it in. If anything goes wrong your old
# version and your data are put back — nothing is lost.
#
# Testing hooks (not for everyday use):
#   TASQ_SKIP_BUILD_FOR_TEST=1   replaces `npm run build` with `true`
#   TASQ_SKIP_INSTALL_FOR_TEST=1 replaces `npm install` with `true`
#   TASQ_PORT=<port>             use another port instead of 4744 (testing)
#   TASQ_UPDATE_SOURCE=<path>    or pass the update folder as the first
#                                argument, instead of the Desktop/Downloads
#                                search.
set -u -o pipefail

cd "$(dirname "$0")" || exit 1
APP_DIR="$(pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
PORT="${TASQ_PORT:-4744}"
LAUNCHD_LABEL="com.tasq.server"
LAUNCHD_PLIST="/Library/LaunchDaemons/$LAUNCHD_LABEL.plist"
KEEP_BACKUPS=5

STAGE=""
ZIP_DIR=""
SMOKE_PID=""
LAUNCHD_OURS=0

# Double-clicked windows wait for Return so they don't vanish; automated runs
# (no terminal attached) close without asking.
finish() {
  if [ -t 0 ]; then
    read -r -p "Press Return to close." _
  fi
  return 0
}

fail() {
  echo
  echo "$*"
  finish
  exit 1
}

cleanup() {
  if [ -n "$SMOKE_PID" ]; then kill "$SMOKE_PID" 2>/dev/null; fi
  [ -n "$STAGE" ] && rm -rf "$STAGE"
  [ -n "$ZIP_DIR" ] && rm -rf "$ZIP_DIR"
}
trap cleanup EXIT

# Put the board back the way it was running: launchd service if this install
# used one, otherwise hand off to start.command in its own window.
restore_service() {
  if [ "$LAUNCHD_OURS" = 1 ]; then
    echo "Starting the board again (background service)..."
    if ! sudo launchctl bootstrap system "$LAUNCHD_PLIST" 2>/dev/null; then
      sudo launchctl kickstart -k "system/$LAUNCHD_LABEL" 2>/dev/null || {
        echo
        echo "Could not restart the background service automatically."
        echo "Double-click start.command to start the board."
      }
    fi
  fi
}

# Stopping early (before the backup) keeps the plain `cp` below safe: the
# database is never caught mid-write. Only unload the launchd job if it really
# belongs to THIS app folder — install.sh writes the app path into the plist.
if launchctl print "system/$LAUNCHD_LABEL" >/dev/null 2>&1 \
   && [ -f "$LAUNCHD_PLIST" ] && grep -q "$APP_DIR" "$LAUNCHD_PLIST" 2>/dev/null; then
  LAUNCHD_OURS=1
fi

if [ "$LAUNCHD_OURS" = 1 ]; then
  echo "Stopping the board for the update..."
  sudo launchctl bootout "system/$LAUNCHD_LABEL" || {
    fail "Could not stop the board's background service (you may have cancelled the password prompt). Nothing was changed."
  }
  # bootout returns before the port is actually free — wait like install.sh does.
  for _ in $(seq 1 50); do
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 0.2
  done
elif lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "The Tasq board is running right now.
Close the Tasq window first, then run this update again."
fi

echo "Backing up your data first..."

BK="$APP_DIR/data-backups/pre-update-$(date '+%Y-%m-%d-%H%M%S')"
mkdir -p "$BK" || fail "Could not create the backup folder. Nothing was changed."
# Plain cp is safe here because the server is stopped — no writes to catch.
[ -d "$APP_DIR/data" ] && cp -R "$APP_DIR/data" "$BK/data"
[ -f "$APP_DIR/.env.local" ] && cp "$APP_DIR/.env.local" "$BK/.env.local"
# Old code (including the old build) goes in too, so a bad update can be
# rolled back without rebuilding. node_modules is left out to keep it small.
rsync -a \
  --exclude /data --exclude /data-backups --exclude /backups --exclude /logs \
  --exclude /node_modules \
  "$APP_DIR/" "$BK/code/"
echo "  backup: $BK"

# Prune old pre-update backups, newest five survive.
ls -dt "$APP_DIR"/data-backups/pre-update-* 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | while IFS= read -r old; do
  rm -rf "$old"
done

echo "Looking for the update..."

SRC="${1:-${TASQ_UPDATE_SOURCE:-}}"
if [ -z "$SRC" ]; then
  # Newest Tasq-update folder next to the app, on the Desktop, or in Downloads.
  for base in "$(dirname "$APP_DIR")" "$HOME/Desktop" "$HOME/Downloads"; do
    newest="$(ls -dt "$base"/Tasq-update* 2>/dev/null | head -1)"
    if [ -n "$newest" ] && [ -d "$newest" ]; then SRC="$newest"; break; fi
  done
fi
if [ -z "$SRC" ]; then
  # Newest Tasq-update zip on the Desktop or in Downloads — unzip it to a
  # temp dir and use the folder inside that actually contains the app.
  for base in "$HOME/Desktop" "$HOME/Downloads"; do
    zip="$(ls -t "$base"/Tasq-update*.zip 2>/dev/null | head -1)"
    [ -n "$zip" ] || continue
    ZIP_DIR="$(mktemp -d)"
    echo "Unzipping $(basename "$zip")..."
    if ! unzip -q -o "$zip" -d "$ZIP_DIR"; then
      fail "That zip would not open. Ask Landon to send it again. Nothing was changed — your board is fine."
    fi
    if [ -f "$ZIP_DIR/package.json" ]; then
      SRC="$ZIP_DIR"
    else
      found="$(find "$ZIP_DIR" -maxdepth 3 -name package.json 2>/dev/null | head -1)"
      [ -n "$found" ] && SRC="$(dirname "$found")"
    fi
    [ -n "$SRC" ] && break
    rm -rf "$ZIP_DIR"; ZIP_DIR=""
  done
fi

GIT_MODE=0
if [ -z "$SRC" ]; then
  # No bundle anywhere — fall back to git pull if this install came from git.
  if [ -d "$APP_DIR/.git" ] && command -v git >/dev/null 2>&1 && git -C "$APP_DIR" remote 2>/dev/null | grep -q .; then
    GIT_MODE=1
    echo "No update folder found — updating from the internet instead."
  else
    fail "No update was found.
Put the folder Landon gave you (it is called Tasq-update) on the Desktop,
in Downloads, or next to this app — then run this again.
Nothing was changed — your board is fine."
  fi
fi

if [ "$GIT_MODE" = 0 ] && [ ! -f "$SRC/package.json" ]; then
  fail "The update folder does not look like a Tasq update (no package.json in it).
Ask Landon for the right folder. Nothing was changed — your board is fine."
fi

echo "Preparing the update (the board stays off for a few minutes)..."

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/tasq-update-stage.XXXXXX")"

# Start staging as a copy of the current install (code + node_modules, so the
# install step is fast when nothing changed).
rsync -a \
  --exclude /data --exclude /data-backups --exclude /backups --exclude /logs \
  --exclude /node_modules --exclude /.env.local \
  "$APP_DIR/" "$STAGE/"
[ -d "$APP_DIR/node_modules" ] && rsync -a "$APP_DIR/node_modules/" "$STAGE/node_modules/"
[ -f "$APP_DIR/.env.local" ] && cp "$APP_DIR/.env.local" "$STAGE/.env.local"

if [ "$GIT_MODE" = 1 ]; then
  # Pull inside the staging copy: if the pull or the build fails, the live
  # app was never touched.
  if ! git -C "$STAGE" pull --ff-only; then
    echo
    echo "Could not download the update. Nothing was changed — your board is fine."
    restore_service
    finish
    exit 1
  fi
else
  # Copy the new code over the staging copy. The exclude list is what must
  # never come from the bundle: your data, your settings, your downloads.
  # --checksum, not the default size+mtime quick check: macOS ships openrsync,
  # which skips a same-size file even when its contents changed, and a zip keeps
  # the mtimes baked into it. Comparing by content is the only reliable way to
  # be sure an edit actually lands. The tree here (no node_modules) is small.
  if ! rsync -a --delete --checksum \
    --exclude /data --exclude /data-backups --exclude /backups --exclude /logs \
    --exclude /node_modules --exclude /.env.local --exclude /bin --exclude /.git \
    "$SRC/" "$STAGE/"; then
    fail "Could not copy the update into place. Nothing was changed — your board is fine."
  fi
fi

# Reinstall dependencies only when the recipe changed (or there is nothing to
# reuse) — otherwise the copied node_modules are already right.
INSTALL_NEEDED=0
if [ ! -d "$STAGE/node_modules" ]; then
  INSTALL_NEEDED=1
elif ! cmp -s "$STAGE/package-lock.json" "$APP_DIR/package-lock.json"; then
  INSTALL_NEEDED=1
fi
if [ "$INSTALL_NEEDED" = 1 ]; then
  echo "Installing dependencies (a few minutes)..."
  if [ "${TASQ_SKIP_INSTALL_FOR_TEST:-0}" = "1" ]; then
    echo "  (test mode: install skipped)"
  else
    if ! (cd "$STAGE" && npm install --no-audit --no-fund); then
      rm -rf "$STAGE"
      echo
      echo "The update didn't take — nothing changed, your board is fine."
      restore_service
      finish
      exit 1
    fi
  fi
fi

echo "Building the new version (this takes a few minutes)..."
if [ "${TASQ_SKIP_BUILD_FOR_TEST:-0}" = "1" ]; then
  echo "  (test mode: build skipped)"
else
  if ! (cd "$STAGE" && npm run build); then
    rm -rf "$STAGE"
    echo
    echo "The update didn't take — nothing changed, your board is fine."
    restore_service
    finish
    exit 1
  fi
fi

echo "Swapping in the new version..."
# update.command is excluded: this script is the file bash is executing right
# now, and rewriting it mid-run can corrupt the run. A newer copy from the
# bundle is swapped in safely at the end instead (see below).
# --checksum for the same reason as above: openrsync would otherwise leave a
# changed same-size file untouched, so the "update" would silently do nothing.
if ! rsync -a --delete --checksum \
  --exclude /data --exclude /data-backups --exclude /backups --exclude /logs \
  --exclude /node_modules --exclude /.env.local --exclude /bin --exclude /update.command \
  "$STAGE/" "$APP_DIR/"; then
  echo
  echo "The swap failed halfway — putting your old version back..."
  rsync -a --delete --checksum \
    --exclude /data --exclude /data-backups --exclude /backups --exclude /logs \
    --exclude /node_modules --exclude /.env.local --exclude /bin --exclude /update.command \
    "$BK/code/" "$APP_DIR/"
  restore_service
  fail "The update didn't take — your old version is back and your board is fine."
fi

# Only when the dependency recipe changed does node_modules follow (see the
# install step above). Everything else keeps the existing node_modules.
if [ "$INSTALL_NEEDED" = 1 ] && [ "${TASQ_SKIP_INSTALL_FOR_TEST:-0}" != "1" ]; then
  rsync -a --delete "$STAGE/node_modules/" "$APP_DIR/node_modules/"
fi

# Read the version now (the new VERSION file is in place); the stamp is written
# only after the smoke boot passes, so a rolled-back update never leaves a
# version.txt claiming a version that is not actually installed.
VERSION="unknown"
[ -f "$APP_DIR/VERSION" ] && VERSION="$(head -1 "$APP_DIR/VERSION" | tr -d '[:space:]')"

echo "Starting the board once to check the update..."
SMOKE_LOG="$(mktemp)"
( cd "$APP_DIR" && PORT="$PORT" npm run start ) >"$SMOKE_LOG" 2>&1 &
SMOKE_PID=$!

SMOKE_OK=0
for _ in $(seq 1 60); do
  # Any HTTP response at all counts — even an error page means the server
  # came up and the database migrations ran.
  if curl -s -o /dev/null -m 3 "http://127.0.0.1:$PORT"; then SMOKE_OK=1; break; fi
  kill -0 "$SMOKE_PID" 2>/dev/null || break
  sleep 1
done

if [ "$SMOKE_OK" = 0 ]; then
  kill "$SMOKE_PID" 2>/dev/null; wait "$SMOKE_PID" 2>/dev/null; SMOKE_PID=""
  echo "The new version would not start. Putting your old version back..."
  rsync -a --delete --checksum \
    --exclude /data --exclude /data-backups --exclude /backups --exclude /logs \
    --exclude /node_modules --exclude /.env.local --exclude /bin --exclude /update.command \
    "$BK/code/" "$APP_DIR/"
  # Old code means the old dependency recipe may be back — reconcile quietly.
  if [ "${TASQ_SKIP_INSTALL_FOR_TEST:-0}" != "1" ]; then
    ( cd "$APP_DIR" && npm install --no-audit --no-fund >/dev/null 2>&1 ) || \
      echo "(could not refresh the libraries — if the board misbehaves, tell Landon)"
  fi
  restore_service
  echo
  echo "The update didn't take — your old version is back, and nothing was lost."
  echo "Tell Landon the update failed; this window showed the error above."
  finish
  exit 1
fi

kill "$SMOKE_PID" 2>/dev/null; wait "$SMOKE_PID" 2>/dev/null; SMOKE_PID=""

# The new version booted cleanly — now it is safe to stamp it.
printf '%s — updated %s\n' "$VERSION" "$(date '+%Y-%m-%d %H:%M:%S')" > "$APP_DIR/data/version.txt"

restore_service

# If the bundle carries a newer update.command, swap it in last with mv —
# replacing the directory entry is safe while the old script still runs; a
# rewrite would not be.
if [ "$GIT_MODE" = 0 ] && [ -f "$SRC/update.command" ] && ! cmp -s "$SRC/update.command" "$APP_DIR/update.command"; then
  cp "$SRC/update.command" "$APP_DIR/update.command.new" \
    && chmod +x "$APP_DIR/update.command.new" \
    && mv -f "$APP_DIR/update.command.new" "$APP_DIR/update.command"
fi

echo
echo "The update is done. Your data was kept."
echo "  version: $VERSION"
echo "  backup of the old version: $BK"
echo
echo "You can delete the Tasq-update folder now."
finish
exit 0
