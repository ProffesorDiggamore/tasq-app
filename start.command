#!/bin/bash
# Double-click this file in Finder to run the Tasq.
# Close this window (or Ctrl+C) when done.

cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
PORT=4744

if ! command -v npm >/dev/null 2>&1; then
  echo "Node/npm not found. Install it from https://nodejs.org then run this again."
  read -r -p "Press Return to close." _
  exit 1
fi

# Another copy already running (the launchd service, or a second window) would
# just fail on the port, so say which and stop rather than half-starting.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Something is already using port $PORT — the board may already be running."
  echo "Open http://localhost:$PORT to check."
  open "http://localhost:$PORT"
  read -r -p "Press Return to close." _
  exit 0
fi

[ -d node_modules ] || { echo "Installing dependencies (first run only)..."; npm install; }

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
echo "Leave this window open. Repeating tasks and the overdue nudges only run"
echo "while it is. Press Ctrl+C to stop."
echo
npm run start
