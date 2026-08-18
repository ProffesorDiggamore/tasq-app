#!/bin/bash
# Nightly SQLite backup, keeping 30 days.
#
# Uses sqlite3's own .backup rather than `cp`. The board is live and in WAL
# mode, so a raw copy can catch the file mid-write and produce a database that
# restores to garbage — the failure you only discover on the day you need it.
set -euo pipefail

APP_DIR="${APEX_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DB="$APP_DIR/data/apex.db"
DEST_DIR="$APP_DIR/backups"
KEEP_DAYS=30

mkdir -p "$DEST_DIR"

if [ ! -f "$DB" ]; then
  echo "[apex-backup] no database at $DB yet — nothing to do."
  exit 0
fi

STAMP="$(date '+%Y-%m-%d')"
DEST="$DEST_DIR/apex-$STAMP.db"
TMP="$DEST.partial"

rm -f "$TMP" "$TMP-wal" "$TMP-shm"
sqlite3 "$DB" ".backup '$TMP'"

# Prove the copy is readable before it replaces today's backup.
if ! sqlite3 "$TMP" 'pragma integrity_check;' | grep -q '^ok$'; then
  echo "[apex-backup] integrity check FAILED — keeping the previous backup." >&2
  rm -f "$TMP" "$TMP-wal" "$TMP-shm"
  exit 1
fi

# The backup inherits WAL mode, so opening it above created sidecar files.
# Fold them in and switch the copy to a single self-contained file — a restore
# should be one `cp`, and stray sidecars would survive the prune below forever.
sqlite3 "$TMP" 'pragma journal_mode=DELETE;' >/dev/null
rm -f "$TMP-wal" "$TMP-shm"

mv -f "$TMP" "$DEST"
echo "[apex-backup] $(date '+%Y-%m-%d %H:%M:%S') wrote $DEST ($(du -h "$DEST" | cut -f1))"

# Prune anything older than the retention window.
find "$DEST_DIR" -name 'apex-*.db' -type f -mtime "+$KEEP_DAYS" -print -delete
