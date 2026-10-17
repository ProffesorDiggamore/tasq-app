#!/bin/bash
# Double-click to safely download the latest published Tasq release.
# update.command still performs the backup, staged build, smoke boot and
# automatic rollback. This file only finds and downloads the release.
set -u -o pipefail

cd "$(dirname "$0")" || exit 1
ROOT="$PWD"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if [ -t 1 ]; then
  B=$'\033[1m'; D=$'\033[2m'; G=$'\033[32m'; R=$'\033[31m'; X=$'\033[0m'
else
  B=''; D=''; G=''; R=''; X=''
fi

finish() {
  [ -t 0 ] && read -r -p "  Press Return to close. " _
  return 0
}
stop() {
  printf '\n  %s✗ %s%s\n\n' "$R$B" "$1" "$X"
  [ -n "${2:-}" ] && printf '  %s\n\n' "$2"
  finish
  exit 1
}

printf '\n  %sTasq updates%s\n\n' "$B" "$X"

command -v curl >/dev/null 2>&1 || stop "This Mac is missing curl." "Use the manual Tasq-update folder instead."
command -v node >/dev/null 2>&1 || stop "Node is not installed." "Run Tasq.app once first; it installs everything Tasq needs."
[ -x "$ROOT/update.command" ] || stop "update.command is missing from this Tasq folder."

CURRENT="$(head -1 "$ROOT/VERSION" 2>/dev/null | tr -d '[:space:]')"
[ -n "$CURRENT" ] || CURRENT="unknown"
API_URL="${TASQ_RELEASE_API_URL:-https://api.github.com/repos/ProffesorDiggamore/tasq-app/releases/latest}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/tasq-release.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT INT TERM

printf '  %s·%s Checking for a published release…' "$D" "$X"
if ! curl -fsSL --connect-timeout 10 --max-time 30 \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  "$API_URL" -o "$WORK/release.json"; then
  printf '\r\033[K'
  stop "Could not check for updates." "Tasq still works offline. Ask Landon for a Tasq-update zip and use update.command."
fi

DETAILS="$(node - "$WORK/release.json" <<'NODE'
const fs = require('node:fs')
const release = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const asset = Array.isArray(release.assets)
  ? release.assets.find((item) => item && item.name === 'Tasq-update.zip')
  : null
if (release.tag_name && asset?.browser_download_url) {
  process.stdout.write(`${release.tag_name}\n${asset.browser_download_url}`)
}
NODE
)" || stop "The update service returned an unreadable response."

TAG="$(printf '%s\n' "$DETAILS" | sed -n '1p')"
ASSET_URL="$(printf '%s\n' "$DETAILS" | sed -n '2p')"
[ -n "$TAG" ] && [ -n "$ASSET_URL" ] \
  || stop "No customer-ready release is published yet." "Tasq is unchanged. Ask Landon for a Tasq-update zip and use update.command."

LATEST="${TAG#v}"
printf '\r\033[K'
if [ "$CURRENT" = "$LATEST" ]; then
  printf '  %s✓%s Tasq %s is already the newest published version.\n\n' "$G" "$X" "$CURRENT"
  finish
  exit 0
fi

printf '  Current: %s\n' "$CURRENT"
printf '  Latest:  %s%s%s\n\n' "$B" "$LATEST" "$X"
printf '  %s·%s Downloading the update…' "$D" "$X"
if ! curl -fL --connect-timeout 10 --max-time 300 "$ASSET_URL" -o "$WORK/Tasq-update.zip" >/dev/null 2>&1; then
  printf '\r\033[K'
  stop "The update download failed." "Tasq was not changed. Try again when the internet connection is stable."
fi
printf '\r\033[K  %s✓%s Downloaded %s\n' "$G" "$X" "$TAG"

mkdir -p "$WORK/unpacked"
unzip -q "$WORK/Tasq-update.zip" -d "$WORK/unpacked" \
  || stop "The downloaded update would not open." "Tasq was not changed."

if [ -f "$WORK/unpacked/package.json" ]; then
  SOURCE="$WORK/unpacked"
else
  PACKAGE="$(find "$WORK/unpacked" -maxdepth 3 -name package.json -type f | head -1)"
  [ -n "$PACKAGE" ] || stop "The release is not a valid Tasq update." "Tasq was not changed."
  SOURCE="$(dirname "$PACKAGE")"
fi

printf '\n'
exec "$ROOT/update.command" "$SOURCE"
