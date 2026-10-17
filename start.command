#!/bin/bash
# Double-click this file in Finder to run the Tasq board.
# Close this window (or Ctrl+C) when done.
#
# First run on a new Mac does everything: installs Node if it is missing,
# installs the app's dependencies, generates the keys, offers to put the board
# on a public HTTPS address with Tailscale, builds, and starts.
# Every run after that skips whatever is already done.

cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:/Applications/Tailscale.app/Contents/MacOS:$PATH"
# TASQ_PORT is only for isolated QA and unusual deployments. A normal
# double-click still owns 4744, and every address/tunnel below follows the
# same value instead of silently splitting across ports.
export PORT="${TASQ_PORT:-${PORT:-4744}}"

# ------------------------------------------------------------------ output ---
#
# What a shop owner sees in this window is the only part of the install they
# ever look at, so it is one column, one symbol per line, and nothing that
# looks like a stack trace unless something actually broke. The noisy parts —
# npm install, next build — are captured and only shown when they fail.

if [ -t 1 ]; then
  B=$'\033[1m'; D=$'\033[2m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; X=$'\033[0m'
else
  B=''; D=''; G=''; Y=''; R=''; X=''
fi

ok()   { printf '  %s✓%s %s\n' "$G" "$X" "$1"; }
note() { printf '  %s·%s %s\n' "$D" "$X" "$1"; }
warn() { printf '  %s!%s %s\n' "$Y" "$X" "$1"; }
rule() { printf '  %s%s%s\n' "$D" "────────────────────────────────────────────────" "$X"; }

stop() {
  printf '\n  %s✗ %s%s\n\n' "$R$B" "$1" "$X"
  [ -n "${2:-}" ] && printf '  %s\n\n' "$2"
  read -r -p "  Press Return to close. " _
  exit 1
}

# Run something loud, quietly. The label sits on one line and turns into a tick
# or a cross; the output only appears if there is a reason to read it.
quietly() {
  local label="$1"; shift
  local log; log="$(mktemp)"
  # The in-place redraw only makes sense on a terminal. Piped to a file it
  # would just bury escape codes in the log, so there we print once, at the end.
  [ -t 1 ] && printf '  %s·%s %s…' "$D" "$X" "$label"
  if "$@" >"$log" 2>&1; then
    [ -t 1 ] && printf '\r\033[K'
    ok "$label"
    rm -f "$log"
    return 0
  fi
  [ -t 1 ] && printf '\r\033[K'
  printf '  ✗ %s\n\n' "$label"
  tail -n 40 "$log"
  rm -f "$log"
  return 1
}

printf '\n  %sTasq%s\n\n' "$B" "$X"

# A folder that arrived by AirDrop, download, or USB stick is quarantined, and
# macOS then refuses to run the scripts inside it. Clearing it here covers
# update.command and the setup scripts; this file itself was already let
# through by whoever opened it.
if xattr -p com.apple.quarantine . >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine . 2>/dev/null || true
fi

# ------------------------------------------------------------------- node ---

if ! command -v node >/dev/null 2>&1; then
  printf '\n  %sNode is not installed on this Mac%s\n' "$B" "$X"
  note "Tasq runs on Node — a free install from nodejs.org, signed by the"
  note "Node project. No Apple ID and no App Store needed."
  printf '\n'
  read -r -p "  Download and install it now? [Y/n] " reply
  case "$reply" in
    ''|y|Y|yes|YES) ;;
    *) stop "Node is required." "Install it from https://nodejs.org then run this again." ;;
  esac

  INDEX="$(curl -fsS https://nodejs.org/dist/index.json 2>/dev/null || true)"
  NODE_VER="$(printf '%s' "$INDEX" | tr '}' '\n' | grep '"lts":"' | head -1 | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
  [ -n "$NODE_VER" ] || stop "Could not reach nodejs.org." "Check the internet connection, or install Node by hand from https://nodejs.org"

  NODE_PKG="$(mktemp -d)/node.pkg"
  printf '\n  Downloading Node %s\n' "$NODE_VER"
  curl -fL --progress-bar -o "$NODE_PKG" "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER.pkg" \
    || stop "The download failed." "Install Node by hand from https://nodejs.org"

  # Do not hand root an installer macOS will not vouch for.
  spctl -a -vv -t install "$NODE_PKG" >/dev/null 2>&1 \
    || stop "That installer did not pass macOS's signature check." "Delete it and install Node by hand from https://nodejs.org"

  note "macOS will ask for this Mac's password to install it."
  sudo installer -pkg "$NODE_PKG" -target / >/dev/null || stop "The Node installer failed."
  rm -f "$NODE_PKG"
  export PATH="/usr/local/bin:$PATH"
  hash -r
  command -v node >/dev/null 2>&1 \
    || stop "Node installed but is not on the PATH." "Close this window, open a new one, and run this again."
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 20 ] || stop "Node $(node -v) is too old — version 20 or newer is required." "Update it from https://nodejs.org"
command -v npm >/dev/null 2>&1 || stop "npm is missing, which is unusual with Node installed." "Reinstall Node from https://nodejs.org"
ok "Node $(node -v)"

# ------------------------------------------------------------------- port ---

# Another copy already running (the launchd service, or a window left open days
# ago) would just fail on the port. An OLD copy is the dangerous case: it keeps
# serving a build from whenever it started, so new work looks like it vanished.
# Take over the port when the process is this board's own server; step aside
# only for something that is not ours.
PORT_PIDS="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null)"
if [ -n "$PORT_PIDS" ]; then
  OURS=""
  for pid in $PORT_PIDS; do
    # cwd of the listener — only a process running out of THIS folder is ours.
    pcwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | tail -1)"
    [ "$pcwd" = "$PWD" ] && OURS="$OURS $pid"
  done
  if [ -z "$OURS" ]; then
    stop "Something else on this Mac is already using port $PORT." \
         "Close it and run this again, or open http://localhost:$PORT to see what it is."
  fi
  # shellcheck disable=SC2086
  kill $OURS 2>/dev/null
  for _ in $(seq 1 40); do
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 0.25
  done
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    kill -9 $OURS 2>/dev/null
    sleep 1
  fi
  ok "Stopped an older copy that was still running"
fi

# ----------------------------------------------------------- dependencies ---

# Reinstalling only when node_modules is absent misses the case that actually
# bites: an update arrives with new packages in the lockfile and the build then
# fails on a missing module. Stamp the lockfile we installed from and compare.
STAMP=node_modules/.tasq-lock-stamp
LOCK_HASH="$(shasum -a 256 package-lock.json 2>/dev/null | cut -d' ' -f1)"
if [ ! -d node_modules ]; then
  note "First run — the next step takes a couple of minutes."
  quietly "Installed dependencies" npm install --no-audit --no-fund \
    || stop "Installing dependencies failed — the errors are above."
  printf '%s\n' "$LOCK_HASH" > "$STAMP"
elif [ "$LOCK_HASH" != "$(cat "$STAMP" 2>/dev/null)" ]; then
  quietly "Installed the new dependencies this version needs" npm install --no-audit --no-fund \
    || stop "Installing dependencies failed — the errors are above."
  printf '%s\n' "$LOCK_HASH" > "$STAMP"
else
  ok "Dependencies"
fi

# ---------------------------------------------------------------- secrets ---

# Session-cookie encryption key. Required, but a shop owner should never have
# to know that: generate a strong one on first run and keep it in .env.local.
# Written BEFORE the build so it is baked into the server bundle too. Never
# regenerated afterwards — that would silently log everyone out.
if ! grep -q '^SESSION_SECRET=' .env.local 2>/dev/null; then
  umask 077
  printf 'SESSION_SECRET=%s\n' "$(head -c 48 /dev/urandom | base64 | tr -d '\n=')" >> .env.local
  ok "Generated this board's session key"
fi

# ------------------------------------------------------- public https ------

# Phones need a real https address for notifications and Add to Home Screen.
# Offer it once; a "no" is remembered so this does not nag every launch.
HAS_PUBLIC=0
grep -q '^TASQ_PUBLIC_URL=https://' .env.local 2>/dev/null && HAS_PUBLIC=1
grep -q '^TASQ_TUNNEL_TOKEN=.' .env.local 2>/dev/null && HAS_PUBLIC=1
grep -q '^TASQ_SKIP_TUNNEL=1' .env.local 2>/dev/null && HAS_PUBLIC=1
if [ "$HAS_PUBLIC" -eq 0 ] && [ -t 0 ]; then
  printf '\n  %sThis board has no address phones can use from outside the shop%s\n' "$B" "$X"
  note "Notifications and Add to Home Screen both need a real https address."
  note "Tailscale gives you one free — no domain to buy, nothing to open on"
  note "the router. About five minutes and a Tailscale login."
  printf '\n'
  read -r -p "  Set that up now? [Y/n] " reply
  case "$reply" in
    ''|y|Y|yes|YES)
      printf '\n'
      bash setup/tailscale.sh || warn "Tailscale setup did not finish. Try again any time: bash setup/tailscale.sh"
      printf '\n'
      ;;
    *)
      printf 'TASQ_SKIP_TUNNEL=1\n' >> .env.local
      note "Skipped — the board will work on the shop network only."
      note "Change your mind later: bash setup/tailscale.sh"
      ;;
  esac
fi

# Setting Tailscale up once is not the same as it being up now. A reboot, a
# Tailscale update, or someone quitting the app leaves the node stopped and the
# funnel cleared, and the board would then go on printing an https address that
# answers nothing. Check and repair it on every launch — silent when there is
# nothing to fix, and never fatal.
if grep -q '^TASQ_PUBLIC_URL=https://.*\.ts\.net' .env.local 2>/dev/null; then
  if bash setup/tailscale.sh --ensure; then
    ok "Public address"
  else
    warn "Could not check the public address — the board still works on the shop network."
  fi
fi

# ------------------------------------------------------------------ build ---

quietly "Built" npm run build || stop "The build failed — the errors are above."

# ----------------------------------------------------------------- start ---

if [ "${TASQ_NO_OPEN:-0}" != "1" ]; then
  ( for _ in $(seq 1 120); do
      nc -z 127.0.0.1 "$PORT" 2>/dev/null && { open "http://localhost:$PORT"; break; }
      sleep 0.5
    done ) &
fi

LAN="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
PUBLIC="$(sed -n 's|^TASQ_PUBLIC_URL=\(https://.*\)|\1|p' .env.local 2>/dev/null | tail -1)"

printf '\n'
rule
printf '\n'
printf '  %-14s %s\n' "On this Mac" "http://localhost:$PORT"
[ -n "$LAN" ]    && printf '  %-14s %s\n' "At the shop" "http://$LAN:$PORT"
[ -n "$PUBLIC" ] && printf '  %-14s %s%s%s\n' "From anywhere" "$B" "$PUBLIC" "$X"
[ -n "$PUBLIC" ] && printf '  %-14s %sput this one on phones%s\n' "" "$D" "$X"

# The first-run activation code is deliberately NOT printed here. The server
# prints it in its own box on every boot until the board is claimed (see
# lib/setup.ts), and a code that appears twice in one window reads like two
# different codes to the person squinting at it.

printf '\n'
rule
printf '\n'

# --- Optional Cloudflare Tunnel (gives phones an https address) ---
# Runs only when a token is present in .env.local as TASQ_TUNNEL_TOKEN=...
# (see docs/CLOUDFLARE-SETUP.md). No token, no tunnel — the board still works.
# Tailscale users have their address already and never reach this block.
TUNNEL_TOKEN=""
if [ -f .env.local ]; then
  TUNNEL_TOKEN=$(sed -n 's/^TASQ_TUNNEL_TOKEN=//p' .env.local | tail -1)
fi
TUNNEL_PID=""
# The launchd tunnel job (setup/cloudflared.sh / bootstrap.sh) already covers
# this machine — never run a second connector beside it.
if [ -n "$TUNNEL_TOKEN" ] && launchctl print system/com.tasq.tunnel >/dev/null 2>&1; then
  TUNNEL_TOKEN=""
fi
if [ -n "$TUNNEL_TOKEN" ]; then
  # Find or fetch cloudflared: PATH, then bundled copy, then download once.
  CFD="$(command -v cloudflared || true)"
  if [ -z "$CFD" ] && [ -x ./bin/cloudflared ]; then CFD=./bin/cloudflared; fi
  if [ -z "$CFD" ]; then
    ARCH="$(uname -m)"; [ "$ARCH" != "arm64" ] && ARCH="amd64"
    mkdir -p bin
    # Release assets are tarballs containing the single cloudflared binary.
    if curl -fsSL -o bin/cloudflared.tgz "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-$ARCH.tgz" \
       && tar -xzf bin/cloudflared.tgz -C bin cloudflared && chmod +x bin/cloudflared; then
      CFD=./bin/cloudflared
    else
      warn "Could not download cloudflared — continuing without the tunnel."
      rm -f bin/cloudflared bin/cloudflared.tgz
    fi
  fi
  if [ -n "$CFD" ]; then
    # Restart it if it ever hard-exits; the edge handles transient reconnects.
    # Logged to data/tunnel.log next to the database.
    ( while true; do
        "$CFD" tunnel --no-autoupdate run --token "$TUNNEL_TOKEN" >> data/tunnel.log 2>&1
        sleep 5
      done ) &
    TUNNEL_PID=$!
  fi
fi

cleanup() {
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

printf '  %sLeave this window open.%s Repeating tasqs and the overdue nudges\n' "$D" "$X"
printf '  %sonly run while it is. Press Ctrl+C to stop.%s\n\n' "$D" "$X"

# --silent drops npm's own "> tasq@1.0.0 start" echo. The sed drops next's
# opening banner, which repeats the two addresses already printed above, and
# its config-load timing, which means nothing to a shop owner. Everything else
# — Ready, the setup-code box, real errors — comes through untouched. sed -l
# keeps it line-buffered, so output still arrives as it happens.
npm run start --silent 2>&1 | sed -l \
  -e '/^[[:space:]]*▲ *Next\.js/d' \
  -e '/^[[:space:]]*[-─] *Local:/d' \
  -e '/^[[:space:]]*[-─] *Network:/d' \
  -e '/^[[:space:]]*[-─] *Environments:/d' \
  -e '/Running next\.config/d'
