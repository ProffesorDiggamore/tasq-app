#!/bin/bash
# Nightly SQLite backup, keeping 30 days, with an optional second copy.
#
# Uses sqlite3's own .backup rather than `cp`. The board is live and in WAL
# mode, so a raw copy can catch the file mid-write and produce a database that
# restores to garbage — the failure you only discover on the day you need it.
#
# Set TASQ_BACKUP_OFFSITE_DIR (in .env.local is fine) to a synced folder —
# iCloud Drive, Dropbox, a NAS mount — and every night's verified backup is
# copied there too, so a dead Mac does not take the history with it.
set -euo pipefail

APP_DIR="${TASQ_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DB="$APP_DIR/data/tasq.db"
DEST_DIR="$APP_DIR/backups"
KEEP_DAYS=30

# The launchd job only passes TASQ_ROOT, so the .env.local is read here —
# last entry wins, matching how the server resolves duplicates. The `|| true`
# matters: with pipefail on, a grep that finds nothing must not kill the run.
OFFSITE_DIR="${TASQ_BACKUP_OFFSITE_DIR:-}"
ENV_FILE="$APP_DIR/.env.local"
if [ -f "$ENV_FILE" ]; then
  ENV_VALUE="$(grep -E '^TASQ_BACKUP_OFFSITE_DIR=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  ENV_VALUE="${ENV_VALUE//\"/}"
  ENV_VALUE="${ENV_VALUE//\'}"
  [ -n "$ENV_VALUE" ] && OFFSITE_DIR="$ENV_VALUE"
fi

mkdir -p "$DEST_DIR"

if [ ! -f "$DB" ]; then
  echo "[tasq-backup] no database at $DB yet — nothing to do."
  exit 0
fi

STAMP="$(date '+%Y-%m-%d')"
DEST="$DEST_DIR/tasq-$STAMP.db"
TMP="$DEST.partial"

rm -f "$TMP" "$TMP-wal" "$TMP-shm"
sqlite3 "$DB" ".backup '$TMP'"

# Prove the copy is readable before it replaces today's backup.
if ! sqlite3 "$TMP" 'pragma integrity_check;' | grep -q '^ok$'; then
  echo "[tasq-backup] integrity check FAILED — keeping the previous backup." >&2
  rm -f "$TMP" "$TMP-wal" "$TMP-shm"
  exit 1
fi

# The backup inherits WAL mode, so opening it above created sidecar files.
# Fold them in and switch the copy to a single self-contained file — a restore
# should be one `cp`, and stray sidecars would survive the prune below forever.
sqlite3 "$TMP" 'pragma journal_mode=DELETE;' >/dev/null
rm -f "$TMP-wal" "$TMP-shm"

mv -f "$TMP" "$DEST"
echo "[tasq-backup] $(date '+%Y-%m-%d %H:%M:%S') wrote $DEST ($(du -h "$DEST" | cut -f1))"

# Second copy into a synced folder. The file is already verified and
# self-contained, so this is a straight copy — if the folder exists but the
# copy fails (disk full, sync daemon wedged), say so without failing the run:
# the local backup is still good.
if [ -n "$OFFSITE_DIR" ]; then
  if mkdir -p "$OFFSITE_DIR" && cp -f "$DEST" "$OFFSITE_DIR/tasq-$STAMP.db"; then
    echo "[tasq-backup] copied to $OFFSITE_DIR"
    find "$OFFSITE_DIR" -name 'tasq-*.db' -type f -mtime "+$KEEP_DAYS" -print -delete
  else
    echo "[tasq-backup] WARNING: could not copy to $OFFSITE_DIR — local backup stands." >&2
  fi
fi

# Prune anything older than the retention window.
find "$DEST_DIR" -name 'tasq-*.db' -type f -mtime "+$KEEP_DAYS" -print -delete
