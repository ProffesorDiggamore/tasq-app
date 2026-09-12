#!/bin/bash
#
# Tasq — put the board on a public HTTPS address with Tailscale Funnel.
#
#   bash setup/tailscale.sh
#
# Run as yourself, not sudo. It asks for the Mac's password at the two steps
# that need root (signing in, and publishing the port).
#
# Why this exists separately from bootstrap.sh: a shop Mac often has no
# Homebrew, no Apple ID, and no App Store access. This installs Tailscale from
# Tailscale's own signed, notarised .pkg — the standalone build, not the App
# Store one — so none of that matters. macOS accepts it because Tailscale
# notarised it, not because anyone is signed in.
#
# Safe to run again: every step checks before it acts.
#
# Flags:
#   --yes    accept every prompt (unattended; cannot do the browser sign-in)
#   --off    take the board back off the public internet
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-4744}"
ASSUME_YES=0
MODE=on

for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    --off) MODE=off ;;
    -h|--help) sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

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

confirm() {
  local prompt="$1" reply
  [ "$ASSUME_YES" -eq 1 ] && { info "$prompt — yes (--yes)"; return 0; }
  [ -t 0 ] || { warn "$prompt — no terminal to ask at, assuming no."; return 1; }
  read -r -p "    ${BOLD}${prompt}${RESET} [Y/n] " reply || return 1
  case "$reply" in ''|y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

set_env() {
  local key="$1" value="$2" file="$APP_DIR/.env.local" tmp
  touch "$file"
  if grep -qE "^${key}=" "$file"; then
    tmp="$(mktemp)"
    grep -vE "^${key}=" "$file" > "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
    mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
  chmod 600 "$file"
}

# The CLI lives inside the app bundle. /usr/local/bin/tailscale is a symlink the
# installer usually makes, but "usually" is not something to hang a setup on.
find_tailscale() {
  if command -v tailscale >/dev/null 2>&1; then command -v tailscale; return 0; fi
  for candidate in \
    /Applications/Tailscale.app/Contents/MacOS/Tailscale \
    /usr/local/bin/tailscale \
    /opt/homebrew/bin/tailscale
  do
    [ -x "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }
  done
  return 1
}

[ "$(uname -s)" = "Darwin" ] || die "This script is for macOS."
[ "$(id -u)" -eq 0 ] && die "Don't run this with sudo. Run it as yourself; it asks for the password when it needs one."

TS="$(find_tailscale || true)"

# --------------------------------------------------------------------- off ---

if [ "$MODE" = off ]; then
  step "Taking the board off the public internet"
  [ -n "$TS" ] || die "Tailscale is not installed here, so nothing is published."
  sudo "$TS" funnel --bg off >/dev/null 2>&1 || warn "Funnel was not on."
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  [ -n "$LAN_IP" ] && set_env TASQ_PUBLIC_URL "http://$LAN_IP:$PORT"
  ok "Public address is off. The shop network address still works."
  info "Restart the board so it stops handing out the old address:"
  info "  sudo launchctl kickstart -k system/com.tasq.server"
  exit 0
fi

# ----------------------------------------------------------------- install ---

step "Tailscale"

if [ -z "$TS" ]; then
  info "Not installed. Tailscale ships a signed installer that needs no Apple"
  info "ID, no App Store, and no Homebrew — fetching that."
  if ! confirm "Download and install Tailscale (~50 MB)?"; then
    die "Nothing installed. Get it manually from https://tailscale.com/download/mac and run this again."
  fi
  PKG="$(mktemp -d)/Tailscale.pkg"
  # 'latest' redirects to the current versioned .pkg — the standalone
  # ("macsys") build, which is the one that can run a funnel in the background.
  curl -fL --progress-bar -o "$PKG" \
    "https://pkgs.tailscale.com/stable/Tailscale-latest-macos.pkg" \
    || die "Could not download Tailscale. Check the internet connection, or install it by hand from https://tailscale.com/download/mac"

  # Refuse an installer Apple will not vouch for rather than walking someone
  # through right-click-Open on a package that runs as root.
  if ! spctl -a -vv -t install "$PKG" >/dev/null 2>&1; then
    die "The downloaded installer did not pass macOS's signature check. Delete it and install Tailscale by hand from https://tailscale.com/download/mac"
  fi
  ok "Installer downloaded and signature checked"

  info "macOS will ask for this Mac's password to install it."
  sudo installer -pkg "$PKG" -target / >/dev/null || die "The installer failed. Try opening $PKG by hand."
  rm -f "$PKG"
  TS="$(find_tailscale || true)"
  [ -n "$TS" ] || die "Tailscale installed but the command is missing. Open the Tailscale app once, then run this again."
  ok "Installed"
else
  ok "Already installed ($TS)"
fi

# -------------------------------------------------------------- sign in ------

step "Signing in"

if "$TS" status >/dev/null 2>&1; then
  ok "Already signed in"
else
  warn "Not signed in to Tailscale."
  info "Use the SHOP's own Tailscale account, not yours — the board must not"
  info "depend on your account still existing in two years. A free account"
  info "takes a minute to make with any email address."
  info "A browser window opens; sign in there, then come back to this window."
  if [ "$ASSUME_YES" -eq 1 ] || [ ! -t 0 ]; then
    die "Sign-in needs a person at the keyboard. Run this script again without --yes."
  fi
  confirm "Open the sign-in page now?" || die "Stopped. Run this again when you have the shop's Tailscale login."
  sudo "$TS" up || die "Sign-in did not complete."
  "$TS" status >/dev/null 2>&1 || die "Still not signed in. Open the Tailscale app and sign in, then run this again."
  ok "Signed in"
fi

MACHINE="$("$TS" status --json 2>/dev/null | sed -n 's/.*"DNSName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 | sed 's/\.$//' || true)"
[ -n "$MACHINE" ] && info "This machine is $MACHINE"

# --------------------------------------------------------------- funnel ------

step "Publishing the board"

warn "This puts port $PORT on the public internet over HTTPS."
info "Anyone with the address reaches the sign-in screen and nothing more —"
info "every action still needs a person's PIN."
info "It is also the only way phones get notifications: browsers refuse them"
info "on a plain-http address, and that is a browser rule, not a Tasq one."

FUNNEL_URL="$("$TS" funnel status 2>/dev/null | grep -oE 'https://[a-zA-Z0-9._-]+\.ts\.net' | head -1 || true)"
if [ -n "$FUNNEL_URL" ]; then
  ok "Already published at $FUNNEL_URL"
else
  if ! confirm "Turn on public access?"; then
    info "Left off. The board works on the shop network only, without notifications."
    exit 0
  fi
  if ! sudo "$TS" funnel --bg "$PORT" >/dev/null 2>&1; then
    warn "Funnel would not start. It is almost always one of two things in the"
    warn "Tailscale admin console (https://login.tailscale.com/admin):"
    info "  1. DNS → HTTPS Certificates is switched off. Turn it on."
    info "  2. Access Controls does not grant the funnel attribute. Add:"
    info '     "nodeAttrs": [{ "target": ["autogroup:member"], "attr": ["funnel"] }]'
    die "Fix one of those, then run this script again."
  fi
  info "Waiting for the certificate (up to a minute the first time)…"
  for _ in $(seq 1 30); do
    FUNNEL_URL="$("$TS" funnel status 2>/dev/null | grep -oE 'https://[a-zA-Z0-9._-]+\.ts\.net' | head -1 || true)"
    [ -n "$FUNNEL_URL" ] && break
    sleep 2
  done
  [ -n "$FUNNEL_URL" ] || die "Published, but no address appeared. Check: $TS funnel status"
  ok "Public address: $FUNNEL_URL"
fi

# ------------------------------------------------------------ addresses ------

step "Telling the board its addresses"

LAN_IP=""
for iface in en0 en1 en2; do
  candidate="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
  [ -n "$candidate" ] && { LAN_IP="$candidate"; break; }
done

ORIGINS="${FUNNEL_URL#https://}"
[ -n "$LAN_IP" ] && ORIGINS="$ORIGINS,$LAN_IP:$PORT"

set_env TASQ_PUBLIC_URL "$FUNNEL_URL"
set_env TASQ_ALLOWED_ORIGINS "$ORIGINS"
set_env TASQ_COOKIE_SECURE true
ok "Phones will be pointed at $FUNNEL_URL"
ok "Accepting requests from: $ORIGINS"

if launchctl print system/com.tasq.server >/dev/null 2>&1; then
  info "Restarting the background service so it picks the new settings up…"
  sudo launchctl kickstart -k system/com.tasq.server >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do
    curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login" 2>/dev/null && break
    sleep 1
  done
  ok "Restarted"
else
  warn "The board is not installed as a background service — restart it yourself"
  info "(close the start.command window and double-click it again)."
fi

# ---------------------------------------------------------------- after ------

printf '\n%s\n\n' "${BOLD}${GREEN}Done.${RESET}"
printf '  %sAnywhere%s    %s\n' "$BOLD" "$RESET" "$FUNNEL_URL"
[ -n "$LAN_IP" ] && printf '  %sAt the shop%s http://%s:%s\n' "$BOLD" "$RESET" "$LAN_IP" "$PORT"
echo
printf '%s\n' "${BOLD}One more thing, in a browser${RESET}"
echo "  Open https://login.tailscale.com/admin/machines, find this Mac, open its"
echo "  … menu and choose Disable key expiry. Without it Tailscale expires the"
echo "  key after about six months and the address silently stops working."
echo
printf '%s\n' "${BOLD}Later${RESET}"
echo "  Take it back offline   bash setup/tailscale.sh --off"
echo "  Check it is published  $TS funnel status"
