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
export PORT=4744

say()  { printf '\n==> %s\n' "$1"; }
stop() { printf '\n%s\n' "$1"; read -r -p "Press Return to close." _; exit 1; }

# A folder that arrived by AirDrop, download, or USB stick is quarantined, and
# macOS then refuses to run the scripts inside it. Clearing it here covers
# update.command and the setup scripts; this file itself was already let
# through by whoever opened it.
if xattr -p com.apple.quarantine . >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine . 2>/dev/null || true
fi

# ------------------------------------------------------------------- node ---

if ! command -v node >/dev/null 2>&1; then
  say "Node is not installed on this Mac"
  echo "Tasq runs on Node. It is a free install from nodejs.org, signed by the"
  echo "Node project — no Apple ID and no App Store needed."
  echo
  read -r -p "Download and install it now? [Y/n] " reply
  case "$reply" in
    ''|y|Y|yes|YES) ;;
    *) stop "Install Node yourself from https://nodejs.org then run this again." ;;
  esac

  INDEX="$(curl -fsS https://nodejs.org/dist/index.json 2>/dev/null || true)"
  NODE_VER="$(printf '%s' "$INDEX" | tr '}' '\n' | grep '"lts":"' | head -1 | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
  [ -n "$NODE_VER" ] || stop "Could not reach nodejs.org. Check the internet connection, or install Node by hand from https://nodejs.org"

  NODE_PKG="$(mktemp -d)/node.pkg"
  echo "Downloading Node $NODE_VER…"
  curl -fL --progress-bar -o "$NODE_PKG" "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER.pkg" \
    || stop "The download failed. Install Node by hand from https://nodejs.org"

  # Do not hand root an installer macOS will not vouch for.
  spctl -a -vv -t install "$NODE_PKG" >/dev/null 2>&1 \
    || stop "That installer did not pass macOS's signature check. Delete it and install Node by hand from https://nodejs.org"

  echo "macOS will ask for this Mac's password to install it."
  sudo installer -pkg "$NODE_PKG" -target / >/dev/null || stop "The Node installer failed."
  rm -f "$NODE_PKG"
  export PATH="/usr/local/bin:$PATH"
  hash -r
  command -v node >/dev/null 2>&1 || stop "Node installed but is not on the PATH. Close this window, open a new one, and run this again."
  echo "Node $(node -v) installed."
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 20 ] || stop "Node $(node -v) is too old — version 20 or newer is required. Update it from https://nodejs.org"
command -v npm >/dev/null 2>&1 || stop "npm is missing, which is unusual with Node installed. Reinstall Node from https://nodejs.org"

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
    echo "Something else on this Mac is already using port $PORT."
    stop "Close it and run this again, or open http://localhost:$PORT to see what it is."
  fi
  echo "An older copy of the board is still running — restarting it so you get"
  echo "the current version."
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
fi

# ----------------------------------------------------------- dependencies ---

# Reinstalling only when node_modules is absent misses the case that actually
# bites: an update arrives with new packages in the lockfile and the build then
# fails on a missing module. Stamp the lockfile we installed from and compare.
STAMP=node_modules/.tasq-lock-stamp
LOCK_HASH="$(shasum -a 256 package-lock.json 2>/dev/null | cut -d' ' -f1)"
if [ ! -d node_modules ]; then
  say "Installing dependencies (first run — takes a couple of minutes)"
  npm install --no-audit --no-fund || stop "Installing dependencies failed — see the errors above."
  printf '%s\n' "$LOCK_HASH" > "$STAMP"
elif [ "$LOCK_HASH" != "$(cat "$STAMP" 2>/dev/null)" ]; then
  say "This version needs some new dependencies — installing them"
  npm install --no-audit --no-fund || stop "Installing dependencies failed — see the errors above."
  printf '%s\n' "$LOCK_HASH" > "$STAMP"
fi

# ---------------------------------------------------------------- secrets ---

# Session-cookie encryption key. Required, but a shop owner should never have
# to know that: generate a strong one on first run and keep it in .env.local.
# Written BEFORE the build so it is baked into the server bundle too. Never
# regenerated afterwards — that would silently log everyone out.
if ! grep -q '^SESSION_SECRET=' .env.local 2>/dev/null; then
  umask 077
  printf 'SESSION_SECRET=%s\n' "$(head -c 48 /dev/urandom | base64 | tr -d '\n=')" >> .env.local
  echo "Created .env.local with a generated session key."
fi

# ------------------------------------------------------- public https ------

# Phones need a real https address for notifications and Add to Home Screen.
# Offer it once; a "no" is remembered so this does not nag every launch.
HAS_PUBLIC=0
grep -q '^TASQ_PUBLIC_URL=https://' .env.local 2>/dev/null && HAS_PUBLIC=1
grep -q '^TASQ_TUNNEL_TOKEN=.' .env.local 2>/dev/null && HAS_PUBLIC=1
grep -q '^TASQ_SKIP_TUNNEL=1' .env.local 2>/dev/null && HAS_PUBLIC=1
if [ "$HAS_PUBLIC" -eq 0 ] && [ -t 0 ]; then
  say "This board has no address phones can use from outside the shop"
  echo "Notifications and Add to Home Screen both need a real https address."
  echo "Tailscale gives you one free, with no domain to buy and nothing to open"
  echo "on the router. It takes about five minutes and a Tailscale login."
  echo
  read -r -p "Set that up now? [Y/n] " reply
  case "$reply" in
    ''|y|Y|yes|YES)
      bash setup/tailscale.sh || echo "Tailscale setup did not finish — carrying on without it. Re-run any time with: bash setup/tailscale.sh"
      ;;
    *)
      printf 'TASQ_SKIP_TUNNEL=1\n' >> .env.local
      echo "Skipped. The board will work on the shop network only."
      echo "Change your mind later: bash setup/tailscale.sh"
      ;;
  esac
fi

# ------------------------------------------------------------------ build ---

say "Building"
npm run build || stop "The build failed — see the errors above."

( for i in $(seq 1 120); do
    nc -z 127.0.0.1 "$PORT" 2>/dev/null && { open "http://localhost:$PORT"; break; }
    sleep 0.5
  done ) &

echo
echo "Tasq is starting on http://localhost:$PORT"
LAN="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
[ -n "$LAN" ] && echo "On the shop network: http://$LAN:$PORT"
PUBLIC="$(sed -n 's|^TASQ_PUBLIC_URL=\(https://.*\)|\1|p' .env.local 2>/dev/null | tail -1)"
[ -n "$PUBLIC" ] && echo "From anywhere (use this on phones): $PUBLIC"
echo

# First-run activation code. The server also prints it once it boots; this
# surfaces it right away when the board has been started before but never set
# up, and keeps watching in case this is a genuine first boot.
if [ -f data/setup-code.txt ]; then
  echo "Setup code (enter at http://localhost:$PORT/setup):"
  grep '^Code:' data/setup-code.txt | sed 's/^Code:/ /'
  echo
else
  ( for i in $(seq 1 120); do
      [ -f data/setup-code.txt ] && {
        echo
        echo "Setup code (enter at http://localhost:$PORT/setup):"
        grep '^Code:' data/setup-code.txt | sed 's/^Code:/ /'
        echo
        break
      }
      sleep 0.5
    done ) &
fi
# --- Optional Cloudflare Tunnel (gives phones an https address) ---
# Runs only when a token is present in .env.local as TASQ_TUNNEL_TOKEN=...
# (see CLOUDFLARE-SETUP.md). No token, no tunnel — the board still works.
# Tailscale users have their address already and never reach this block.
TUNNEL_TOKEN=""
if [ -f .env.local ]; then
  TUNNEL_TOKEN=$(sed -n 's/^TASQ_TUNNEL_TOKEN=//p' .env.local | tail -1)
fi
TUNNEL_PID=""
# The launchd tunnel job (setup/cloudflared.sh / bootstrap.sh) already covers
# this machine — never run a second connector beside it.
if [ -n "$TUNNEL_TOKEN" ] && launchctl print system/com.tasq.tunnel >/dev/null 2>&1; then
  echo "Tunnel already running as a background service — skipping the in-window one."
  TUNNEL_TOKEN=""
fi
if [ -n "$TUNNEL_TOKEN" ]; then
  # Find or fetch cloudflared: PATH, then bundled copy, then download once.
  CFD="$(command -v cloudflared || true)"
  if [ -z "$CFD" ] && [ -x ./bin/cloudflared ]; then CFD=./bin/cloudflared; fi
  if [ -z "$CFD" ]; then
    ARCH="$(uname -m)"; [ "$ARCH" != "arm64" ] && ARCH="amd64"
    echo "Downloading cloudflared (one time)..."
    mkdir -p bin
    # Release assets are tarballs containing the single cloudflared binary.
    if curl -fsSL -o bin/cloudflared.tgz "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-$ARCH.tgz" \
       && tar -xzf bin/cloudflared.tgz -C bin cloudflared && chmod +x bin/cloudflared; then
      CFD=./bin/cloudflared
    else
      echo "Could not download cloudflared — continuing without the tunnel."
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
    echo "Tunnel running — this board has a permanent https address."
  fi
fi

cleanup() {
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

echo "Leave this window open. Repeating tasks and the overdue nudges only run"
echo "while it is. Press Ctrl+C to stop."
echo
npm run start
