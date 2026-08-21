#!/bin/bash
#
# Moves the board out of /Users/Shared into the coding folder, and sets up
# Tailscale Funnel so notifications work.
#
#   bash setup/relocate.sh
#
# Run as yourself, NOT with sudo. It asks for your password once (for the
# launchd jobs and for Funnel) and opens a browser for you to sign in to
# Tailscale. Homebrew refuses to run as root, which is the other reason not to
# sudo the whole thing.
#
set -euo pipefail

TARGET="/Users/whoslandon/Documents/Dev & Code/Coding Scripts/All Apex/apex-board"
PORT=4744
PHASE="${1:-all}"

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; BLUE=''; RESET=''
fi
step() { printf '\n%s==> %s%s\n' "$BOLD$BLUE" "$1" "$RESET"; }
ok()   { printf '    %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
info() { printf '    %s·%s %s\n' "$DIM" "$RESET" "$1"; }
warn() { printf '    %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
die()  { printf '\n%sStopped:%s %s\n\n' "$BOLD$RED" "$RESET" "$1" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || die "Don't run this with sudo — Homebrew won't work as root. Run 'bash setup/relocate.sh'."

set_env() {
  local key="$1" value="$2" file="$3/.env.local"
  touch "$file"
  if grep -qE "^${key}=" "$file"; then
    local tmp; tmp="$(mktemp)"
    grep -vE "^${key}=" "$file" > "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
    mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

# ---------------------------------------------------------------- phase 1 ---
if [ "$PHASE" = "all" ]; then
  APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

  step "Stopping the background service"
  info "It cannot run from Documents anyway — macOS blocks that."
  for job in server backup; do
    LABEL="com.apexboard.$job"
    sudo launchctl bootout "system/$LABEL" 2>/dev/null || true
    sudo rm -f "/Library/LaunchDaemons/$LABEL.plist"
    ok "removed $LABEL"
  done
  # bootout is asynchronous; give the port a moment to actually free up.
  for _ in $(seq 1 20); do
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 0.5
  done

  step "Moving it to the coding folder"
  if [ "$APP_DIR" = "$TARGET" ]; then
    ok "already there"
  else
    [ -e "$TARGET" ] && die "$TARGET already exists. Move it aside first."
    mkdir -p "$(dirname "$TARGET")"
    mv "$APP_DIR" "$TARGET"
    ok "$TARGET"
  fi

  # The script file itself just moved, so continue from the copy that now lives
  # at the destination rather than reading from a path that no longer exists.
  exec bash "$TARGET/setup/relocate.sh" funnel
fi

# ---------------------------------------------------------------- phase 2 ---
APP_DIR="$TARGET"
cd "$APP_DIR"

step "Setting up Tailscale (this is the part that makes notifications work)"
info "Phones only allow notifications over a real https address."

if ! command -v tailscale >/dev/null 2>&1; then
  if [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then
    export PATH="/Applications/Tailscale.app/Contents/MacOS:$PATH"
  elif command -v brew >/dev/null 2>&1; then
    info "Installing Tailscale…"
    brew install --cask tailscale || die "Homebrew could not install Tailscale. Get it from https://tailscale.com/download and run this again."
    [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] && \
      export PATH="/Applications/Tailscale.app/Contents/MacOS:$PATH"
  else
    die "Tailscale is not installed and Homebrew is missing. Get it from https://tailscale.com/download."
  fi
fi
command -v tailscale >/dev/null 2>&1 || die "Tailscale still is not on PATH. Open the Tailscale app once, then run this again."
ok "Tailscale is installed"

if ! tailscale status >/dev/null 2>&1; then
  step "Sign in to Tailscale"
  info "A browser window is about to open. Create a free account or sign in,"
  info "then come back here — this script waits for you."
  open -a Tailscale 2>/dev/null || true
  sudo tailscale up || die "Sign-in did not complete. Run 'sudo tailscale up' and try again."
fi
tailscale status >/dev/null 2>&1 || die "Still not signed in to Tailscale."
ok "Signed in"

step "Turning on the public https address"
warn "This publishes port $PORT to the internet over HTTPS."
info "Anyone with the address reaches the sign-in screen; a PIN is still needed."
sudo tailscale funnel --bg "$PORT" >/dev/null 2>&1 || warn "Funnel did not start cleanly — checking anyway."

info "Waiting for the certificate (can take up to a minute)…"
FUNNEL_URL=""
for _ in $(seq 1 40); do
  FUNNEL_URL="$(tailscale funnel status 2>/dev/null | grep -oE 'https://[a-zA-Z0-9._-]+\.ts\.net' | head -1 || true)"
  [ -n "$FUNNEL_URL" ] && break
  sleep 2
done

if [ -z "$FUNNEL_URL" ]; then
  warn "No public address yet."
  info "Usually one of two things at https://login.tailscale.com/admin :"
  info "  1. DNS -> HTTPS Certificates is not enabled"
  info "  2. your ACL does not grant the 'funnel' node attribute"
  info "Fix that, then run:  sudo tailscale funnel --bg $PORT"
else
  ok "Public address: $FUNNEL_URL"
fi

step "Telling the board its addresses"
LAN=""
for iface in en0 en1 en2; do
  c="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
  [ -n "$c" ] && { LAN="$c"; break; }
done

ORIGINS=""
[ -n "$FUNNEL_URL" ] && ORIGINS="${FUNNEL_URL#https://}"
if [ -n "$LAN" ]; then
  [ -n "$ORIGINS" ] && ORIGINS="$ORIGINS,"
  ORIGINS="${ORIGINS}${LAN}:${PORT}"
fi

if [ -n "$FUNNEL_URL" ]; then
  set_env APEX_PUBLIC_URL "$FUNNEL_URL" "$APP_DIR"
  ok "Phones will be pointed at $FUNNEL_URL"
elif [ -n "$LAN" ]; then
  set_env APEX_PUBLIC_URL "http://$LAN:$PORT" "$APP_DIR"
fi
[ -n "$ORIGINS" ] && { set_env APEX_ALLOWED_ORIGINS "$ORIGINS" "$APP_DIR"; ok "Accepting requests from: $ORIGINS"; }

printf '\n%s\n\n' "${BOLD}${GREEN}Done.${RESET}"
echo "  The board now lives at:"
echo "    $APP_DIR"
echo
echo "  ${BOLD}Start it:${RESET} double-click start.command in that folder"
echo
[ -n "$FUNNEL_URL" ] && {
  echo "  ${BOLD}On phones:${RESET} $FUNNEL_URL"
  echo "    iPhone  - Safari, Share, Add to Home Screen, open it from the icon"
  echo "    Android - Chrome, menu, Install app"
  echo "    Then sign in and allow notifications."
}
[ -n "$LAN" ] && echo "  ${BOLD}On the shop network:${RESET} http://$LAN:$PORT (no notifications - plain http)"
echo
