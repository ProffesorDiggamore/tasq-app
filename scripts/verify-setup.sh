#!/bin/bash
#
# Checks the installer scripts: shell syntax, plist validity, and the .env.local
# editing that bootstrap.sh does. That last one guards the worst thing this
# installer could do — clobber the VAPID keys on a re-run and sign every phone
# out of notifications.
#
#   npm run verify:setup
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOOTSTRAP="$ROOT/setup/bootstrap.sh"
fail=0

check() {
  if [ "$2" = "$3" ]; then
    echo "  ok    $1"
  else
    fail=$((fail + 1))
    echo "  FAIL  $1 — got '$2' want '$3'"
  fi
}
ok_if() {
  if "$@" >/dev/null 2>&1; then echo "  ok    $LABEL"; else fail=$((fail + 1)); echo "  FAIL  $LABEL"; fi
}

echo
echo "Shell syntax"
for f in "$ROOT"/setup/*.sh; do
  LABEL="$(basename "$f") parses"
  ok_if bash -n "$f"
done

echo
echo "Scripts are executable"
for f in "$ROOT"/setup/*.sh; do
  LABEL="$(basename "$f") is executable"
  ok_if test -x "$f"
done

echo
echo "launchd job definitions"
for f in "$ROOT"/setup/*.plist; do
  tmp="$(mktemp)"
  sed -e 's|__APP_DIR__|/Users/Shared/tasq|g' \
      -e 's|__RUN_USER__|shopuser|g' \
      -e 's|__RUN_HOME__|/Users/shopuser|g' \
      -e 's|__NODE_DIR__|/opt/homebrew/bin|g' \
      -e 's|__CLOUDFLARED__|/opt/homebrew/bin/cloudflared|g' \
      -e 's|__CLOUDFLARED_DIR__|/opt/homebrew/bin|g' "$f" > "$tmp"
  LABEL="$(basename "$f") is a valid plist once filled in"
  ok_if plutil -lint "$tmp"
  LABEL="$(basename "$f") has no placeholders left after filling in"
  ok_if bash -c "! grep -q '__[A-Z_]*__' '$tmp'"
  rm -f "$tmp"
done

echo
echo "Editing .env.local"
APP_DIR="$(mktemp -d)"
# Pull the helpers out of bootstrap.sh so this tests the real implementation.
eval "$(sed -n '/^set_env() {/,/^}/p' "$BOOTSTRAP")"
eval "$(sed -n '/^env_value() {/,/^}/p' "$BOOTSTRAP")"

set_env SESSION_SECRET "abc123"
check "writes a key" "$(env_value SESSION_SECRET)" "abc123"

set_env VAPID_PUBLIC_KEY "PUBKEY"
set_env VAPID_PRIVATE_KEY "PRIVKEY"
set_env PORT "4744"
set_env SESSION_SECRET "replaced"
check "updates a key in place" "$(env_value SESSION_SECRET)" "replaced"
check "leaves the other keys alone" "$(env_value VAPID_PUBLIC_KEY)" "PUBKEY"
check "including ones written after it" "$(env_value PORT)" "4744"
check "never duplicates a key" "$(grep -c '^SESSION_SECRET=' "$APP_DIR/.env.local")" "1"

set_env VAPID_SUBJECT "mailto:chris@example.com"
check "keeps a colon intact" "$(env_value VAPID_SUBJECT)" "mailto:chris@example.com"
set_env TASQ_PUBLIC_URL "https://shop-mac.tail1234.ts.net"
check "keeps a URL intact" "$(env_value TASQ_PUBLIC_URL)" "https://shop-mac.tail1234.ts.net"
set_env TASQ_ALLOWED_ORIGINS "shop-mac.ts.net,192.168.1.50:4744"
check "keeps commas and ports intact" "$(env_value TASQ_ALLOWED_ORIGINS)" "shop-mac.ts.net,192.168.1.50:4744"
set_env SESSION_SECRET 'a+b/c=d_e-f'
check "keeps base64 punctuation intact" "$(env_value SESSION_SECRET)" 'a+b/c=d_e-f'

# The condition bootstrap.sh uses before generating push keys.
needs_keys() {
  [ -z "$(env_value VAPID_PUBLIC_KEY || true)" ] || [ -z "$(env_value VAPID_PRIVATE_KEY || true)" ]
}
if needs_keys; then check "a complete key pair is left alone" "regenerate" "keep"
else check "a complete key pair is left alone" "keep" "keep"; fi

set_env VAPID_PRIVATE_KEY ""
if needs_keys; then check "a half-written pair is replaced" "regenerate" "regenerate"
else check "a half-written pair is replaced" "keep" "regenerate"; fi

rm -rf "$APP_DIR"

echo
echo "Documented commands exist"
LABEL="bootstrap.sh --help works"
ok_if bash "$BOOTSTRAP" --help
LABEL="README points at bootstrap.sh"
ok_if grep -q 'setup/bootstrap.sh' "$ROOT/setup/README.md"

echo
if [ "$fail" -eq 0 ]; then
  echo "All checks passed."
else
  echo "$fail check(s) FAILED."
  exit 1
fi
