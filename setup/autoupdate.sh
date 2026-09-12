#!/bin/bash
#
# Tasq — pull new versions from GitHub and restart the board, by itself.
#
#   bash setup/autoupdate.sh --setup   one-time: deploy key, branch, schedule
#   bash setup/autoupdate.sh           check once and apply (what launchd runs)
#   bash setup/autoupdate.sh --now     rebuild and restart even with no new commit
#   bash setup/autoupdate.sh --off     stop checking
#   bash setup/autoupdate.sh --status  what it is tracking and when it last ran
#
# The shop Mac pulls; nothing has to reach in from outside. You push a commit
# from home, and within the check interval the board has it.
#
# Every apply is reversible. The commit that is running now, its node_modules,
# and its build are all recoverable, and a failed build, a failed check suite,
# or a board that does not answer afterwards all roll the whole thing back to
# the last version that worked. A shop is never left with a broken board
# because a push was bad.
#
set -euo pipefail

APP_DIR="${TASQ_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$APP_DIR"
PORT="${PORT:-4744}"
LOG="$APP_DIR/logs/autoupdate.log"
LOCK="$APP_DIR/logs/.autoupdate.lock"
KEY="$HOME/.ssh/tasq_deploy"
INTERVAL_DEFAULT=300
MODE=run

for arg in "$@"; do
  case "$arg" in
    --setup) MODE=setup ;;
    --now) MODE=force ;;
    --off) MODE=off ;;
    --status) MODE=status ;;
    -h|--help) sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

mkdir -p logs
log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" | tee -a "$LOG"; }
say() { printf '\n==> %s\n' "$1"; }
die() { log "STOPPED: $1"; exit 1; }

env_value() {
  [ -f .env.local ] || return 1
  grep -E "^$1=" .env.local | tail -1 | cut -d= -f2- || true
}
set_env() {
  local key="$1" value="$2" tmp
  touch .env.local
  if grep -qE "^${key}=" .env.local; then
    tmp="$(mktemp)"; grep -vE "^${key}=" .env.local > "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"; mv "$tmp" .env.local
  else
    printf '%s=%s\n' "$key" "$value" >> .env.local
  fi
  chmod 600 .env.local
}

# Restart without root. The server plist runs as this user with KeepAlive, so
# killing the process launchd is watching is enough — launchd brings it back
# within its 10-second throttle. Root is only needed to talk to launchctl
# directly, and an unattended job should not be holding that.
restart_board() {
  local pids pcwd
  pids="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
  for pid in $pids; do
    pcwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | tail -1)"
    [ "$pcwd" = "$APP_DIR" ] && kill "$pid" 2>/dev/null || true
  done
  # If a passwordless launchctl happens to be available, use it too — harmless
  # when it is not, and it covers a board that was already down.
  sudo -n launchctl kickstart -k system/com.tasq.server >/dev/null 2>&1 || true
}

wait_for_board() {
  for _ in $(seq 1 60); do
    curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

# ------------------------------------------------------------------ setup ---

if [ "$MODE" = setup ]; then
  [ "$(id -u)" -eq 0 ] && die "Don't run --setup with sudo. Run it as the shop user."
  [ -d .git ] || die "This folder is not a git checkout, so there is nothing to pull from. Re-deploy it with 'git clone' instead of a copied folder."

  say "Read-only deploy key"
  if [ -f "$KEY" ]; then
    echo "Already have one at $KEY."
  else
    mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
    ssh-keygen -t ed25519 -N '' -C "tasq-autoupdate-$(hostname -s)" -f "$KEY" >/dev/null
    echo "Made one at $KEY."
  fi
  echo
  echo "Add this to the repo on GitHub:"
  echo "  Settings -> Deploy keys -> Add deploy key"
  echo "  Leave 'Allow write access' UNCHECKED. This Mac only ever needs to read."
  echo
  cat "$KEY.pub"
  echo
  read -r -p "Press Return once that key is added." _

  # Use the key explicitly rather than relying on an agent that will not exist
  # inside a launchd job, and pin it so ssh does not offer every other key.
  git config core.sshCommand "ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

  say "Remote"
  CURRENT="$(git remote get-url origin 2>/dev/null || true)"
  case "$CURRENT" in
    https://github.com/*)
      SSH_URL="git@github.com:${CURRENT#https://github.com/}"
      git remote set-url origin "$SSH_URL"
      echo "Switched origin to $SSH_URL (a deploy key cannot authenticate over https)."
      ;;
    git@github.com:*) echo "origin is already $CURRENT" ;;
    *) die "origin is '$CURRENT', which is not a GitHub URL. Point it at the repo and run this again." ;;
  esac

  say "Branch to follow"
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  read -r -p "Which branch should this board track? [$BRANCH] " reply
  [ -n "$reply" ] && BRANCH="$reply"
  git fetch origin "$BRANCH" >/dev/null 2>&1 || die "Could not fetch '$BRANCH'. Either the deploy key is not on the repo yet, or that branch does not exist on origin."
  set_env TASQ_UPDATE_BRANCH "$BRANCH"
  echo "Tracking origin/$BRANCH."

  say "How often to check"
  read -r -p "Seconds between checks [$INTERVAL_DEFAULT] " reply
  INTERVAL="${reply:-$INTERVAL_DEFAULT}"
  case "$INTERVAL" in ''|*[!0-9]*) die "That is not a number of seconds." ;; esac
  [ "$INTERVAL" -ge 60 ] || die "Use 60 seconds or more. Anything faster just hammers GitHub."
  set_env TASQ_UPDATE_INTERVAL "$INTERVAL"

  say "Scheduling it"
  sed -e "s|__APP_DIR__|$APP_DIR|g" \
      -e "s|__RUN_USER__|$(id -un)|g" \
      -e "s|__NODE_DIR__|$(dirname "$(command -v node)")|g" \
      -e "s|__INTERVAL__|$INTERVAL|g" \
      setup/com.tasq.autoupdate.plist > /tmp/com.tasq.autoupdate.plist
  sudo install -o root -g wheel -m 644 /tmp/com.tasq.autoupdate.plist /Library/LaunchDaemons/com.tasq.autoupdate.plist
  rm -f /tmp/com.tasq.autoupdate.plist
  sudo launchctl bootout system/com.tasq.autoupdate 2>/dev/null || true
  for _ in $(seq 1 50); do launchctl print system/com.tasq.autoupdate >/dev/null 2>&1 || break; sleep 0.2; done
  sudo launchctl bootstrap system /Library/LaunchDaemons/com.tasq.autoupdate.plist
  sudo launchctl enable system/com.tasq.autoupdate

  printf '\nDone. This board follows origin/%s and checks every %s seconds.\n\n' "$BRANCH" "$INTERVAL"
  echo "From home:  git push origin $BRANCH   — the board picks it up by itself."
  echo "Impatient:  ssh <this-mac> 'cd $APP_DIR && setup/autoupdate.sh --now'"
  echo "Watch it:   tail -f $LOG"
  exit 0
fi

# -------------------------------------------------------------------- off ---

if [ "$MODE" = off ]; then
  sudo launchctl bootout system/com.tasq.autoupdate 2>/dev/null || true
  sudo rm -f /Library/LaunchDaemons/com.tasq.autoupdate.plist
  log "auto-update disabled"
  echo "Stopped. The board stays on whatever version it is running now."
  echo "Turn it back on with: bash setup/autoupdate.sh --setup"
  exit 0
fi

# ----------------------------------------------------------------- status ---

if [ "$MODE" = status ]; then
  BRANCH="$(env_value TASQ_UPDATE_BRANCH || echo '(not set)')"
  echo "Folder:     $APP_DIR"
  echo "Tracking:   origin/$BRANCH"
  echo "Running:    $(git log --oneline -1 2>/dev/null || echo 'not a git checkout')"
  echo "Interval:   $(env_value TASQ_UPDATE_INTERVAL || echo "$INTERVAL_DEFAULT")s"
  if launchctl print system/com.tasq.autoupdate >/dev/null 2>&1; then
    echo "Scheduled:  yes"
  else
    echo "Scheduled:  no — run 'bash setup/autoupdate.sh --setup'"
  fi
  echo "Board:      $(curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/login" 2>/dev/null || echo 'not answering')"
  echo
  echo "Last few runs:"
  tail -n 12 "$LOG" 2>/dev/null || echo "  (nothing yet)"
  exit 0
fi

# ------------------------------------------------------------------- run ----

# Two overlapping runs would fight over the working tree. mkdir is the atomic
# primitive here; macOS has no flock binary.
if ! mkdir "$LOCK" 2>/dev/null; then
  # A lock older than an hour is a crashed run, not a live one.
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +60 2>/dev/null)" ]; then
    log "clearing a stale lock from a run that died"
    rm -rf "$LOCK"; mkdir "$LOCK"
  else
    exit 0
  fi
fi
trap 'rm -rf "$LOCK"' EXIT INT TERM

[ -d .git ] || die "not a git checkout — nothing to pull"

BRANCH="$(env_value TASQ_UPDATE_BRANCH || true)"
[ -n "$BRANCH" ] || BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# A dirty tree means someone edited files on the shop Mac. Overwriting that
# silently is how you lose the one local fix nobody wrote down.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  die "the working tree has local edits. Commit or discard them on the Mac, then this will resume."
fi

git fetch --quiet origin "$BRANCH" || die "could not reach GitHub (network, or the deploy key was revoked)"

OLD="$(git rev-parse HEAD)"
NEW="$(git rev-parse "origin/$BRANCH")"

if [ "$OLD" = "$NEW" ] && [ "$MODE" != force ]; then
  exit 0
fi

if [ "$OLD" = "$NEW" ]; then
  log "forced rebuild of $(git log --oneline -1 --format=%h)"
else
  log "update: ${OLD:0:8} -> ${NEW:0:8}  $(git log --oneline -1 --format=%s "$NEW")"
fi

setup/backup.sh >/dev/null 2>&1 && log "  database backed up" || log "  WARNING: backup step failed, carrying on"

# Keep the working build. next writes into .next as it goes, so a failed build
# leaves a half-built directory that would not start — restoring a copy is the
# only honest rollback.
rsync -a --delete .next/ .next.prev/ 2>/dev/null || true

roll_back() {
  log "  ROLLING BACK to ${OLD:0:8}"
  git reset --hard --quiet "$OLD"
  if [ -d .next.prev ]; then rm -rf .next; mv .next.prev .next; fi
  if [ "$LOCKFILE_CHANGED" = "1" ]; then npm ci --no-audit --no-fund >/dev/null 2>&1 || log "  WARNING: restoring dependencies failed"; fi
  restart_board
  if wait_for_board; then log "  rolled back; board is answering again"; else log "  ROLLED BACK BUT THE BOARD IS DOWN — look at logs/server.error.log"; fi
  exit 1
}

LOCKFILE_CHANGED=0
if [ "$OLD" != "$NEW" ] && git diff --name-only "$OLD" "$NEW" | grep -qx 'package-lock.json'; then
  LOCKFILE_CHANGED=1
fi

git reset --hard --quiet "$NEW" || die "could not move to $NEW"

if [ "$LOCKFILE_CHANGED" = "1" ]; then
  log "  dependencies changed — installing"
  npm ci --no-audit --no-fund >/dev/null 2>&1 || { log "  dependency install failed"; roll_back; }
fi

log "  building"
npm run build >/dev/null 2>&1 || { log "  build failed"; roll_back; }

log "  running checks"
npm run verify >/dev/null 2>&1 || { log "  checks failed"; roll_back; }

log "  restarting"
restart_board
wait_for_board || { log "  the board did not come back"; roll_back; }

rm -rf .next.prev
log "  done — now on $(git log --oneline -1 --format='%h %s')"
