#!/bin/bash
# Exercises update.command against disposable miniature apps. This proves the
# updater preserves data on success and restores the old code after a failed
# smoke boot without touching the real board.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/tasq-update-test.XXXXXX")"
PORTS=""

cleanup() {
  for port in $PORTS; do
    for pid in $(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true); do
      pcwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | tail -1)"
      case "$pcwd" in "$TMP"/*) kill "$pid" 2>/dev/null || true ;; esac
    done
  done
  rm -rf "$TMP"
}
trap cleanup EXIT

free_port() {
  node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'
}

write_package() {
  local dir="$1"
  mkdir -p "$dir"
  printf '%s\n' '{"name":"tasq-updater-fixture","version":"1.0.0","private":true,"scripts":{"start":"node server.js"}}' > "$dir/package.json"
}

write_server() {
  local path="$1" healthy="$2"
  if [ "$healthy" = yes ]; then
    printf '%s\n' 'require("node:http").createServer((_,res)=>{res.end("ok")}).listen(Number(process.env.PORT),"127.0.0.1")' > "$path"
  else
    printf '%s\n' 'process.exit(23)' > "$path"
  fi
}

make_app() {
  local dir="$1"
  write_package "$dir"
  cp "$ROOT/update.command" "$dir/update.command"
  chmod +x "$dir/update.command"
  mkdir -p "$dir/data"
  printf '%s\n' 'customer-data-must-survive' > "$dir/data/customer.txt"
  printf '%s\n' 'old-code' > "$dir/code.txt"
  printf '%s\n' '0.9.0' > "$dir/VERSION"
  write_server "$dir/server.js" yes
}

run_update() {
  local app="$1" source="$2" port="$3" log="$4"
  PORTS="$PORTS $port"
  (
    cd "$app"
    TASQ_SKIP_BUILD_FOR_TEST=1 \
    TASQ_SKIP_INSTALL_FOR_TEST=1 \
    TASQ_PORT="$port" \
    TASQ_UPDATE_SOURCE="$source" \
      ./update.command
  ) > "$log" 2>&1
}

echo
echo "Transactional updater"

GOOD_APP="$TMP/good-app"
GOOD_SOURCE="$TMP/good-source"
make_app "$GOOD_APP"
write_package "$GOOD_SOURCE"
printf '%s\n' 'new-code' > "$GOOD_SOURCE/code.txt"
printf '%s\n' '1.1.0' > "$GOOD_SOURCE/VERSION"
write_server "$GOOD_SOURCE/server.js" yes
run_update "$GOOD_APP" "$GOOD_SOURCE" "$(free_port)" "$TMP/good.log"

[ "$(cat "$GOOD_APP/code.txt")" = new-code ]
[ "$(cat "$GOOD_APP/data/customer.txt")" = customer-data-must-survive ]
grep -q '^1.1.0 — updated ' "$GOOD_APP/data/version.txt"
echo "  ok    applies a staged update and keeps customer data"

BAD_APP="$TMP/bad-app"
BAD_SOURCE="$TMP/bad-source"
make_app "$BAD_APP"
write_package "$BAD_SOURCE"
printf '%s\n' 'broken-code' > "$BAD_SOURCE/code.txt"
printf '%s\n' '2.0.0' > "$BAD_SOURCE/VERSION"
write_server "$BAD_SOURCE/server.js" no

set +e
run_update "$BAD_APP" "$BAD_SOURCE" "$(free_port)" "$TMP/bad.log"
status=$?
set -e

[ "$status" -ne 0 ]
[ "$(cat "$BAD_APP/code.txt")" = old-code ]
[ "$(cat "$BAD_APP/data/customer.txt")" = customer-data-must-survive ]
grep -q 'old version is back' "$TMP/bad.log"
echo "  ok    rolls back broken code and keeps customer data"

echo
echo "Published release checker"

CHECKER="$TMP/checker"
mkdir -p "$CHECKER"
cp "$ROOT/Check for Updates.command" "$CHECKER/Check for Updates.command"
printf '%s\n' '#!/bin/bash' 'exit 91' > "$CHECKER/update.command"
chmod +x "$CHECKER/Check for Updates.command" "$CHECKER/update.command"
printf '%s\n' '1.2.3' > "$CHECKER/VERSION"
cat > "$CHECKER/release.json" <<'JSON'
{"tag_name":"v1.2.3","assets":[{"name":"Tasq-update.zip","browser_download_url":"https://example.invalid/Tasq-update.zip"}]}
JSON

TASQ_RELEASE_API_URL="file://$CHECKER/release.json" \
  "$CHECKER/Check for Updates.command" > "$TMP/check-current.log" 2>&1
grep -q 'already the newest published version' "$TMP/check-current.log"
echo "  ok    recognizes the installed published version"

set +e
TASQ_RELEASE_API_URL='http://127.0.0.1:1/no-network' \
  "$CHECKER/Check for Updates.command" > "$TMP/check-offline.log" 2>&1
status=$?
set -e
[ "$status" -ne 0 ]
grep -q 'Tasq still works offline' "$TMP/check-offline.log"
grep -q 'use update.command' "$TMP/check-offline.log"
echo "  ok    leaves the app unchanged and names the manual offline fallback"

echo "All updater checks passed."
