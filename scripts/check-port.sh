#!/bin/bash
# Tasq owns one port and everything points at it: the browser bookmark, the
# QR code on the board, the tunnel. When something else is already listening
# there, Next.js does not fail — it quietly serves on the next free port, and
# whatever squatted on ours keeps answering. Stop that here, loudly.
#
# Runs automatically before `npm run dev` and `npm run start` (predev/prestart).
set -euo pipefail

PORT="${PORT:-4744}"
PIDS="$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"

[ -z "$PIDS" ] && exit 0

echo "✗ Port $PORT is already taken — Tasq will not start on a different port silently." >&2
echo "  It belongs to:" >&2
for PID in $PIDS; do
  ps -p "$PID" -o pid=,command= >&2 2>/dev/null || echo "    PID $PID (already gone)" >&2
done
echo >&2
echo "  If it's a leftover server of another project, kill it:  kill $PIDS" >&2
echo "  If it's a stale copy of Tasq itself, same thing:         kill $PIDS" >&2
exit 1
