#!/bin/bash
#
# Tasq — one-command setup for the shop Mac.
#
#   bash setup/bootstrap.sh
#
# Run it as the normal user, NOT with sudo. It asks for your password only at
# the few steps that genuinely need root (launchd, power settings, Tailscale).
# Running the whole thing as root would leave node_modules and the database
# owned by root, which breaks the server afterwards.
#
# Safe to run again. It never regenerates keys that already exist, never
# overwrites the database, and every step reports what it found.
#
# Flags:
#   --yes                accept every prompt (unattended)
#   --tunnel=cloudflare  set up public HTTPS with a Cloudflare Tunnel
#   --tunnel=tailscale    set up public HTTPS with Tailscale Funnel
#   --tunnel=none         LAN-only install, no public access
#   --skip-funnel        alias for --tunnel=none
#   --skip-power         leave the sleep settings alone
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=4744
PREFERRED_HOME="/Users/Shared/tasq"
ASSUME_YES=0
SKIP_FUNNEL=0
SKIP_POWER=0
TUNNEL_CHOICE=""

for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    --tunnel=cloudflare|--tunnel=tailscale) TUNNEL_CHOICE="${arg#--tunnel=}" ;;
    --tunnel=none) SKIP_FUNNEL=1 ;;
    --skip-funnel) SKIP_FUNNEL=1 ;;
    --skip-power) SKIP_POWER=1 ;;
    -h|--help) sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------- output ----

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; BLUE=''; RESET=''
fi

STEP=0
step()  { STEP=$((STEP + 1)); printf '\n%s==> %s. %s%s\n' "$BOLD$BLUE" "$STEP" "$1" "$RESET"; }
ok()    { printf '    %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
info()  { printf '    %s·%s %s\n' "$DIM" "$RESET" "$1"; }
warn()  { printf '    %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
die()   { printf '\n%sStopped:%s %s\n\n' "$BOLD$RED" "$RESET" "$1" >&2; exit 1; }

# Default-yes prompt. Under --yes it answers itself and says so.
confirm() {
  local prompt="$1"
  if [ "$ASSUME_YES" -eq 1 ]; then
    info "$prompt — yes (--yes)"
    return 0
  fi
  if [ ! -t 0 ]; then
    # No terminal to ask at. Defaulting to "yes" here would let a piped or
    # cron-style invocation silently move directories and publish a port.
    warn "$prompt — no terminal to ask at, assuming no. Use --yes to accept."
    return 1
  fi
  local reply
  if ! read -r -p "    ${BOLD}${prompt}${RESET} [Y/n] " reply; then
    warn "$prompt — no answer, assuming no."
    return 1
  fi
  case "$reply" in
    ''|y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

# Update or append KEY=VALUE in .env.local without disturbing anything else.
set_env() {
  local key="$1" value="$2" file="$APP_DIR/.env.local"
  touch "$file"
  if grep -qE "^${key}=" "$file"; then
    local tmp
    tmp="$(mktemp)"
    grep -vE "^${key}=" "$file" > "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
    mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

env_value() {
  local key="$1" file="$APP_DIR/.env.local"
  [ -f "$file" ] || return 1
  grep -E "^${key}=" "$file" | tail -1 | cut -d= -f2- || true
}

printf '%s\n' "${BOLD}Tasq setup${RESET}"
printf '%s\n' "${DIM}$APP_DIR${RESET}"

# ------------------------------------------------------------- preflight ----

step "Checking this machine"

[ "$(uname -s)" = "Darwin" ] || die "This installer is for macOS. See setup/README.md to run it elsewhere."
ok "macOS $(sw_vers -productVersion) on $(uname -m)"

if [ "$(id -u)" -eq 0 ]; then
  die "Don't run this with sudo. Run 'bash setup/bootstrap.sh' as yourself; it will ask for your password when it needs it."
fi

command -v node >/dev/null 2>&1 || die "Node is not installed. Get it from https://nodejs.org (version 20 or newer), then run this again."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node $(node -v) is too old. Version 20 or newer is required."
ok "Node $(node -v)"

command -v npm >/dev/null 2>&1 || die "npm is missing, which is unusual with Node installed. Reinstall Node."
command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 is missing. Install Xcode command line tools: xcode-select --install"
ok "npm $(npm -v), sqlite3 $(sqlite3 --version | cut -d' ' -f1)"

# ------------------------------------------------------------- location -----

step "Checking where the app lives"

case "$APP_DIR" in
  */Documents/*|*/Desktop/*|*/Downloads/*|*/Documents|*/Desktop|*/Downloads)
    warn "This folder is inside a macOS privacy-protected location."
    info "A background service cannot read Documents, Desktop or Downloads, so"
    info "the board would start and then fail with a permissions error."
    echo
    if confirm "Move the app to $PREFERRED_HOME and continue from there?"; then
      [ -e "$PREFERRED_HOME" ] && die "$PREFERRED_HOME already exists. Move or remove it, then run this again."
      sudo mkdir -p "$(dirname "$PREFERRED_HOME")"
      sudo mv "$APP_DIR" "$PREFERRED_HOME"
      sudo chown -R "$USER":staff "$PREFERRED_HOME"
      ok "Moved to $PREFERRED_HOME"
      info "Continuing from the new location…"
      exec bash "$PREFERRED_HOME/setup/bootstrap.sh" "$@"
    else
      die "Move the app somewhere outside Documents/Desktop/Downloads, then run this again."
    fi
    ;;
  *)
    ok "$APP_DIR is fine"
    ;;
esac

mkdir -p "$APP_DIR/logs" "$APP_DIR/data" "$APP_DIR/backups"
chmod +x "$APP_DIR"/setup/*.sh

# ---------------------------------------------------------------- secrets ---

step "Setting up secrets"

if [ -f "$APP_DIR/.env.local" ]; then
  ok "Found an existing .env.local — keeping what is already in it"
else
  info "Creating .env.local"
fi

if [ -z "$(env_value SESSION_SECRET || true)" ]; then
  set_env SESSION_SECRET "$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))')"
  ok "Generated a session secret"
else
  ok "Session secret already set"
fi

if [ -z "$(env_value VAPID_PUBLIC_KEY || true)" ] || [ -z "$(env_value VAPID_PRIVATE_KEY || true)" ]; then
  # Only ever generated once. Regenerating invalidates every phone's push
  # subscription and everyone has to turn notifications on again.
  if [ ! -d "$APP_DIR/node_modules/web-push" ]; then
    info "Installing dependencies first so the push keys can be generated…"
    (cd "$APP_DIR" && npm install --no-audit --no-fund >/dev/null 2>&1) || die "npm install failed. Run 'npm install' in $APP_DIR to see why."
  fi
  KEYS="$(cd "$APP_DIR" && node scripts/generate-vapid.mjs)"
  set_env VAPID_PUBLIC_KEY "$(printf '%s\n' "$KEYS" | grep '^VAPID_PUBLIC_KEY=' | cut -d= -f2-)"
  set_env VAPID_PRIVATE_KEY "$(printf '%s\n' "$KEYS" | grep '^VAPID_PRIVATE_KEY=' | cut -d= -f2-)"
  ok "Generated notification keys"
else
  ok "Notification keys already set — leaving them alone"
  info "Regenerating them would sign every phone out of notifications."
fi

if [ -z "$(env_value VAPID_SUBJECT || true)" ]; then
  set_env VAPID_SUBJECT "mailto:tasq@localhost"
  info "Set a placeholder notification contact address."
  info "Put a real one in .env.local as VAPID_SUBJECT when you get a chance."
fi

set_env PORT "$PORT"
chmod 600 "$APP_DIR/.env.local"
ok "Secrets are in .env.local (readable only by you)"

# ------------------------------------------------------------------ build ---

step "Installing and building"

info "This takes a couple of minutes the first time."
(cd "$APP_DIR" && npm install --no-audit --no-fund) || die "npm install failed."
ok "Dependencies installed"

(cd "$APP_DIR" && npm run build) || die "The build failed. Nothing has been installed as a service yet."
ok "Built"

if (cd "$APP_DIR" && npm run verify >/dev/null 2>&1); then
  ok "All checks passed"
else
  warn "Some checks failed. Run 'npm run verify' to see which."
  confirm "Carry on anyway?" || die "Stopped so you can look at the failures."
fi

# ------------------------------------------------------------------ sleep ---

if [ "$SKIP_POWER" -eq 1 ]; then
  step "Power settings"
  info "Skipped (--skip-power)"
else
  step "Stopping the Mac from sleeping"
  info "A sleeping Mac is an offline board."
  if confirm "Prevent sleep on this machine?"; then
    sudo pmset -a sleep 0 || true
    sudo pmset -a disksleep 0 || true
    sudo pmset -a womp 1 || true
    if pmset -g | grep -q 'lidwake'; then
      sudo pmset -a disablesleep 1 || true
      warn "This is a laptop. Closing the lid still takes the board down — leave it open."
    fi
    ok "Sleep disabled"
  else
    warn "Left alone. The board will go down whenever the Mac sleeps."
  fi
fi

# -------------------------------------------------------------- launchd -----

step "Installing the background service"

info "Two jobs: the board itself, and a nightly database backup at 03:30."

# Offer an offsite copy before the jobs go in, so tonight's backup already
# lands there. iCloud Drive is the zero-setup answer on every Mac with it on.
ICLOUD_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs"
if [ -z "$(env_value TASQ_BACKUP_OFFSITE_DIR || true)" ] && [ -d "$ICLOUD_DIR" ]; then
  if confirm "Also keep the nightly backups in iCloud Drive (survives this Mac dying)?"; then
    OFFSITE="$ICLOUD_DIR/Tasq Backups"
    mkdir -p "$OFFSITE" && set_env TASQ_BACKUP_OFFSITE_DIR "$OFFSITE" && \
      ok "Backups will also land in $OFFSITE"
  fi
fi

sudo TASQ_ASSUME_YES=1 "$APP_DIR/setup/install.sh" || die "Service installation failed. See the output above."
ok "Service installed and started"

info "Waiting for it to come up…"
UP=0
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login" 2>/dev/null; then UP=1; break; fi
  sleep 1
done
if [ "$UP" -eq 1 ]; then
  ok "The board is answering on port $PORT"
else
  warn "It is not answering yet. Check: tail -n 40 $APP_DIR/logs/server.error.log"
fi

# ---------------------------------------------------------------- network ---

step "Working out the addresses"

LAN_IP=""
for iface in en0 en1 en2; do
  candidate="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
  if [ -n "$candidate" ]; then LAN_IP="$candidate"; break; fi
done
if [ -n "$LAN_IP" ]; then
  ok "Shop network address: http://$LAN_IP:$PORT"
  info "Give this Mac a fixed address on the router, or it will change."
else
  warn "Could not find a network address. Is this Mac on Wi-Fi or Ethernet?"
fi

FUNNEL_URL=""
if [ "$SKIP_FUNNEL" -eq 1 ]; then
  info "Skipping off-site access (--tunnel=none)"
else
  step "Setting up off-site access"
  info "Phones need a real public HTTPS address for notifications and for"
  info "Add-to-Home-Screen — plain HTTP will not do. Two free ways to get one:"
  info "  • Cloudflare Tunnel — needs a domain on your Cloudflare account,"
  info "    never expires, no router port to open"
  info "  • Tailscale Funnel  — no domain needed, but each device's key"
  info "    expires after ~180 days unless you turn that off in the admin console"
  echo

  if [ -z "$TUNNEL_CHOICE" ]; then
    if [ "$ASSUME_YES" -eq 1 ] || [ ! -t 0 ]; then
      # Cloudflare setup is interactive (browser sign-in). An unattended run
      # can't do it, so fall back to the Tailscale path here and leave a note.
      TUNNEL_CHOICE=tailscale
      info "Unattended run — using the Tailscale path. For Cloudflare, run"
      info "  bash $APP_DIR/setup/cloudflared.sh   afterward."
    elif confirm "Use Cloudflare Tunnel? (answer no to use Tailscale Funnel instead)"; then
      TUNNEL_CHOICE=cloudflare
    else
      TUNNEL_CHOICE=tailscale
    fi
  fi
fi

if [ "$SKIP_FUNNEL" -eq 0 ] && [ "$TUNNEL_CHOICE" = "cloudflare" ] && [ ! -t 0 ]; then
  warn "Cloudflare Tunnel setup needs a terminal and a browser — skipping here."
  info "Finish it later with: bash $APP_DIR/setup/cloudflared.sh"
elif [ "$SKIP_FUNNEL" -eq 0 ] && [ "$TUNNEL_CHOICE" = "cloudflare" ]; then
  info "Handing off to setup/cloudflared.sh — it will open a browser for sign-in."
  if bash "$APP_DIR/setup/cloudflared.sh"; then
    FUNNEL_URL="$(env_value TASQ_PUBLIC_URL || true)"
    case "$FUNNEL_URL" in
      https://*) ok "Public address: $FUNNEL_URL" ;;
      *) FUNNEL_URL=""; warn "Tunnel finished but no https address landed in .env.local." ;;
    esac
  else
    warn "Cloudflare Tunnel setup did not finish. Re-run it any time with:"
    info "  bash $APP_DIR/setup/cloudflared.sh"
  fi
elif [ "$SKIP_FUNNEL" -eq 0 ] && [ "$TUNNEL_CHOICE" = "tailscale" ]; then

  if ! command -v tailscale >/dev/null 2>&1; then
    if [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then
      export PATH="/Applications/Tailscale.app/Contents/MacOS:$PATH"
    elif command -v brew >/dev/null 2>&1; then
      if confirm "Tailscale is not installed. Install it with Homebrew?"; then
        brew install --cask tailscale || warn "Homebrew could not install it."
        [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] && \
          export PATH="/Applications/Tailscale.app/Contents/MacOS:$PATH"
      fi
    else
      warn "Tailscale is not installed and Homebrew is not available."
      info "Install it from https://tailscale.com/download, then run this script again."
    fi
  fi

  if command -v tailscale >/dev/null 2>&1; then
    ok "Tailscale is installed"
    if ! tailscale status >/dev/null 2>&1; then
      warn "You are not signed in to Tailscale."
      info "A browser window will open. Sign in, then come back here."
      confirm "Sign in now?" && (sudo tailscale up || warn "Sign-in did not complete.")
    fi

    if tailscale status >/dev/null 2>&1; then
      ok "Signed in as $(tailscale status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,""))}catch{console.log("this machine")}})' 2>/dev/null || echo 'this machine')"
      echo
      warn "The next step publishes port $PORT to the public internet over HTTPS."
      info "Anyone with the address reaches the sign-in screen; a PIN is still required."
      if confirm "Turn on public access?"; then
        if sudo tailscale funnel --bg "$PORT" >/dev/null 2>&1; then
          ok "Funnel is on"
        else
          warn "Funnel could not start."
          info "Usually one of two things in the Tailscale admin console:"
          info "  1. DNS → HTTPS Certificates is not enabled"
          info "  2. your ACL does not grant the 'funnel' node attribute"
          info "Fix that, then run: sudo tailscale funnel --bg $PORT"
        fi
        info "Waiting for the certificate…"
        for _ in $(seq 1 30); do
          FUNNEL_URL="$(tailscale funnel status 2>/dev/null | grep -oE 'https://[a-zA-Z0-9._-]+\.ts\.net' | head -1 || true)"
          [ -n "$FUNNEL_URL" ] && break
          sleep 2
        done
        if [ -n "$FUNNEL_URL" ]; then
          ok "Public address: $FUNNEL_URL"
        else
          warn "No public address yet. Check with: tailscale funnel status"
        fi
      else
        info "Left off. The board works on the shop network only."
      fi
    fi
  fi
fi

# ------------------------------------------------------------- addresses ----

step "Telling the board its addresses"

ORIGINS=""
[ -n "$FUNNEL_URL" ] && ORIGINS="${FUNNEL_URL#https://}"
if [ -n "$LAN_IP" ]; then
  [ -n "$ORIGINS" ] && ORIGINS="$ORIGINS,"
  ORIGINS="$ORIGINS$LAN_IP:$PORT"
fi

if [ -n "$FUNNEL_URL" ]; then
  set_env TASQ_PUBLIC_URL "$FUNNEL_URL"
  ok "Phones will be pointed at $FUNNEL_URL"
elif [ -n "$LAN_IP" ]; then
  set_env TASQ_PUBLIC_URL "http://$LAN_IP:$PORT"
  ok "Phones will be pointed at http://$LAN_IP:$PORT"
fi

if [ -n "$ORIGINS" ]; then
  set_env TASQ_ALLOWED_ORIGINS "$ORIGINS"
  ok "Accepting requests from: $ORIGINS"
fi

info "Restarting so the new settings take effect…"
sudo launchctl kickstart -k system/com.tasq.server >/dev/null 2>&1 || true
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login" 2>/dev/null && break
  sleep 1
done
ok "Restarted"

# ----------------------------------------------------------------- done -----

printf '\n%s\n' "${BOLD}${GREEN}Tasq is running.${RESET}"
echo
[ -n "$FUNNEL_URL" ] && printf '  %sAnywhere%s   %s\n' "$BOLD" "$RESET" "$FUNNEL_URL"
[ -n "$LAN_IP" ]     && printf '  %sAt the shop%s http://%s:%s\n' "$BOLD" "$RESET" "$LAN_IP" "$PORT"
printf '  %sOn this Mac%s http://localhost:%s\n' "$BOLD" "$RESET" "$PORT"
echo
printf '%s\n' "${BOLD}What to do now${RESET}"
echo "  1. Open the board and tap Chris to set the first PIN."
echo "  2. Settings → Get it on a phone shows a QR code. Point each phone's"
echo "     camera at it, then use Share → Add to Home Screen."
echo "  3. On each phone, open it from the home screen and allow notifications."
echo
printf '%s\n' "${BOLD}Handy afterwards${RESET}"
echo "  Update it       $APP_DIR/setup/deploy.sh"
echo "  Watch the log   tail -f $APP_DIR/logs/server.log"
echo "  Is it running   launchctl print system/com.tasq.server | grep state"
echo "  Back up now     $APP_DIR/setup/backup.sh"
echo "  Remove it all   $APP_DIR/setup/uninstall.sh"
echo
[ -z "$FUNNEL_URL" ] && [ "$SKIP_FUNNEL" -eq 0 ] && \
  printf '%s\n\n' "${YELLOW}Note: without public access, phones only work on the shop Wi-Fi and notifications are off.${RESET}"
exit 0
