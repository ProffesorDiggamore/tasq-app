#!/bin/bash
# Double-click this file in Finder to run the Tasq.
# Close this window (or Ctrl+C) when done.

cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PORT=4744

if ! command -v npm >/dev/null 2>&1; then
  echo "Node/npm not found. Install it from https://nodejs.org then run this again."
  read -r -p "Press Return to close." _
  exit 1
fi

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
    echo "Close it and run this again, or open http://localhost:$PORT to see what it is."
    read -r -p "Press Return to close." _
    exit 1
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

[ -d node_modules ] || { echo "Installing dependencies (first run only)..."; npm install; }

# Session-cookie encryption key. Required, but a shop owner should never have
# to know that: generate a strong one on first run and keep it in .env.local.
# Written BEFORE the build so it is baked into the server bundle too. Never
# regenerated afterwards — that would silently log everyone out.
if ! grep -q '^SESSION_SECRET=' .env.local 2>/dev/null; then
  umask 077
  printf 'SESSION_SECRET=%s\n' "$(head -c 48 /dev/urandom | base64 | tr -d '\n=')" >> .env.local
  echo "Created .env.local with a generated session key."
fi

echo "Building..."
npm run build || {
  echo
  echo "The build failed — see the errors above."
  read -r -p "Press Return to close." _
  exit 1
}

( for i in $(seq 1 120); do
    nc -z 127.0.0.1 "$PORT" 2>/dev/null && { open "http://localhost:$PORT"; break; }
    sleep 0.5
  done ) &

echo
echo "Tasq is starting on http://localhost:$PORT"
LAN="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
[ -n "$LAN" ] && echo "On the shop network: http://$LAN:$PORT"
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
