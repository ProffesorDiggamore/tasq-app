#!/bin/bash
#
# Tasq — public HTTPS through a Cloudflare Tunnel.
#
#   bash setup/cloudflared.sh [board.example.com]
#
# The alternative to Tailscale Funnel. A named Cloudflare Tunnel gives the board
# a fixed public HTTPS address that never expires, needs no open router port,
# and works behind CGNAT. The one thing it needs that Funnel does not: a domain
# already added to your Cloudflare account (any zone — a $10/yr name is fine).
#
# What it does, all of it idempotent:
#   1. installs cloudflared (Homebrew)
#   2. logs in to Cloudflare and lets you pick the zone (opens a browser)
#   3. creates a tunnel called "tasq" if one does not exist
#   4. writes ~/.cloudflared/config.yml pointing the hostname at port 4744
#   5. points a DNS record at the tunnel
#   6. installs a launchd job so the tunnel comes back after a reboot
#   7. writes the address into .env.local and restarts the board
#
# Run it as yourself, NOT with sudo. It asks for your password once, for the
# launchd job.
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=4744
TUNNEL_NAME="tasq"
HOSTNAME_ARG="${1:-}"

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

[ "$(uname -s)" = "Darwin" ] || die "This script is for macOS."
[ "$(id -u)" -ne 0 ] || die "Don't run this with sudo. Run 'bash setup/cloudflared.sh'; it asks for your password when it needs it."
command -v node >/dev/null 2>&1 || die "Node is not installed. Get it from https://nodejs.org, then run this again."

CF_DIR="$HOME/.cloudflared"

# ---------------------------------------------------------------- install ---

step "Checking for cloudflared"
if ! command -v cloudflared >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    info "Installing cloudflared with Homebrew…"
    brew install cloudflared || die "Homebrew could not install cloudflared. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ and run this again."
  else
    die "cloudflared is not installed and Homebrew is missing. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ and run this again."
  fi
fi
ok "cloudflared $(cloudflared --version 2>/dev/null | awk '{print $3}')"

# ---------------------------------------------------------------- login -----

step "Signing in to Cloudflare"
if [ ! -f "$CF_DIR/cert.pem" ]; then
  info "A browser window will open. Sign in, then pick the domain this board"
  info "should live under. cloudflared saves a certificate and comes back here."
  cloudflared tunnel login || die "Login did not complete. Run 'cloudflared tunnel login' and try again."
fi
[ -f "$CF_DIR/cert.pem" ] || die "No Cloudflare certificate at $CF_DIR/cert.pem. Run 'cloudflared tunnel login'."
ok "Signed in ($CF_DIR/cert.pem)"

# ---------------------------------------------------------------- hostname --

HOSTNAME="$HOSTNAME_ARG"
while [ -z "$HOSTNAME" ]; do
  read -r -p "    ${BOLD}Address for the board, e.g. board.yourshop.com:${RESET} " HOSTNAME || die "No hostname given."
done
case "$HOSTNAME" in
  http*://*) HOSTNAME="${HOSTNAME#*://}" ;;
esac
HOSTNAME="${HOSTNAME%%/*}"
ok "Board will answer at https://$HOSTNAME"

# ---------------------------------------------------------------- tunnel ----

step "Creating the tunnel"
# `tunnel list` is the source of truth; `create` on an existing name errors.
TUNNEL_ID="$(cloudflared tunnel list --output json 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=JSON.parse(s).find(x=>x.name===process.argv[1]);process.stdout.write(t?t.id:"")}catch{}})' "$TUNNEL_NAME" || true)"

if [ -z "$TUNNEL_ID" ]; then
  cloudflared tunnel create "$TUNNEL_NAME" || die "Could not create the tunnel."
  TUNNEL_ID="$(cloudflared tunnel list --output json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=JSON.parse(s).find(x=>x.name===process.argv[1]);process.stdout.write(t?t.id:"")}catch{}})' "$TUNNEL_NAME" || true)"
  [ -n "$TUNNEL_ID" ] || die "Tunnel created but its ID could not be read back. Check 'cloudflared tunnel list'."
  ok "Created tunnel $TUNNEL_NAME ($TUNNEL_ID)"
else
  ok "Tunnel $TUNNEL_NAME already exists ($TUNNEL_ID)"
fi

CRED_FILE="$CF_DIR/$TUNNEL_ID.json"
[ -f "$CRED_FILE" ] || die "The tunnel's credentials file is missing at $CRED_FILE. Delete the tunnel with 'cloudflared tunnel delete $TUNNEL_NAME' and run this again."

# ---------------------------------------------------------------- config ----

step "Writing $CF_DIR/config.yml"
# A single self-contained config the launchd job points at. The catch-all 404
# rule is required — cloudflared refuses a config whose last rule has a hostname.
cat > "$CF_DIR/config.yml" <<YAML
tunnel: $TUNNEL_ID
credentials-file: $CRED_FILE

ingress:
  - hostname: $HOSTNAME
    service: http://localhost:$PORT
  - service: http_status:404
YAML
cloudflared tunnel ingress validate || die "cloudflared rejected the config. See the error above."
ok "Config written and valid"

step "Pointing DNS at the tunnel"
# Errors if the record already exists, which is fine on a re-run.
if cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME" 2>/dev/null; then
  ok "$HOSTNAME now routes to this tunnel"
else
  info "DNS record already exists for $HOSTNAME — leaving it."
  info "If it points at a different tunnel, delete it in the Cloudflare"
  info "dashboard (DNS → Records) and run this again."
fi

# ---------------------------------------------------------------- service ---

step "Installing the background job"
if launchctl print system/com.tasq.server >/dev/null 2>&1; then
  sudo TASQ_ASSUME_YES=1 "$APP_DIR/setup/install.sh" || die "Could not (re)install the launchd jobs."
  ok "Tunnel job installed — it starts on boot and restarts if it drops"
else
  warn "The board's launchd job is not installed yet."
  info "Run 'bash setup/bootstrap.sh' — it installs the board and the tunnel together."
fi

# ---------------------------------------------------------------- env -------

step "Telling the board its address"
set_env() {
  local key="$1" value="$2" file="$APP_DIR/.env.local"
  touch "$file"; chmod 600 "$file"
  if grep -qE "^${key}=" "$file"; then
    local tmp; tmp="$(mktemp)"
    grep -vE "^${key}=" "$file" > "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
    mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}
env_value() { grep -E "^$1=" "$APP_DIR/.env.local" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

set_env TASQ_PUBLIC_URL "https://$HOSTNAME"

# Keep any LAN address already in the origins list; add the new hostname once.
ORIGINS="$(env_value TASQ_ALLOWED_ORIGINS)"
case ",$ORIGINS," in
  *",$HOSTNAME,"*) ;;
  *) [ -n "$ORIGINS" ] && ORIGINS="$ORIGINS,$HOSTNAME" || ORIGINS="$HOSTNAME" ;;
esac
set_env TASQ_ALLOWED_ORIGINS "$ORIGINS"
ok "Public URL: https://$HOSTNAME"
ok "Accepting server actions from: $ORIGINS"

if launchctl print system/com.tasq.server >/dev/null 2>&1; then
  sudo launchctl kickstart -k system/com.tasq.server >/dev/null 2>&1 || true
  info "Restarted the board so the new address takes effect."
fi

printf '\n%s\n\n' "${BOLD}${GREEN}Cloudflare Tunnel is up.${RESET}"
echo "  Board:   https://$HOSTNAME"
echo "  Tunnel:  $TUNNEL_NAME ($TUNNEL_ID)"
echo
echo "  Watch it:   tail -f $APP_DIR/logs/tunnel.log"
echo "  Is it up:   launchctl print system/com.tasq.tunnel | grep state"
echo "  Remove it:  cloudflared tunnel delete $TUNNEL_NAME   (after setup/uninstall.sh)"
echo
# Parsed by bootstrap.sh:
echo "PUBLIC_URL=https://$HOSTNAME"
