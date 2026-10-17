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
#   --yes     accept every prompt (unattended; cannot do the browser sign-in)
#   --off     take the board back off the public internet
#   --ensure  put a board that is already set up back on the air, quietly
#   --boot    keep it on the air by itself, from boot, with nobody logged in
#   --no-boot stop doing that
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
    --ensure) MODE=ensure ;;
    --boot) MODE=boot ;;
    --no-boot) MODE=noboot ;;
    -h|--help) sed -n '3,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; RESET=''
fi
step() { printf '\n  %s%s%s\n' "$BOLD" "$1" "$RESET"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
info() { printf '  %s·%s %s\n' "$DIM" "$RESET" "$1"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
die()  { printf '\n  %s✗ %s%s\n\n' "$BOLD$RED" "$1" "$RESET" >&2; exit 1; }

confirm() {
  local prompt="$1" reply
  [ "$ASSUME_YES" -eq 1 ] && { info "$prompt — yes (--yes)"; return 0; }
  [ -t 0 ] || { warn "$prompt — no terminal to ask at, assuming no."; return 1; }
  read -r -p "  ${BOLD}${prompt}${RESET} [Y/n] " reply || return 1
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
# --ensure is what the launchd job runs, and that job has to be root to bring
# the node up with nobody logged in. Every other mode is still hands-off-sudo.
if [ "$(id -u)" -eq 0 ] && [ "$MODE" != ensure ]; then
  die "Don't run this with sudo. Run it as yourself; it asks for the password when it needs one."
fi

TS="$(find_tailscale || true)"

# ------------------------------------------------------------------ shared ---

ts_state() {
  "$TS" status --json 2>/dev/null \
    | sed -n 's/.*"BackendState"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1
}
ts_dnsname() {
  "$TS" status --json 2>/dev/null \
    | sed -n 's/.*"DNSName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 | sed 's/\.$//'
}
# The human-readable funnel status prints commented-out lines for addresses
# that are configured but not serving, which reads as "on" to a grep. The JSON
# says plainly what is allowed and where it points, so use that.
funnel_url() {
  "$TS" funnel status --json 2>/dev/null \
    | sed -n 's|.*"\([a-zA-Z0-9._-]*\.ts\.net\):443"[[:space:]]*:[[:space:]]*true.*|https://\1|p' | head -1
}
# On, AND pointing at this board. A funnel left over from some other port is
# not the same thing as a working one.
funnel_serves_port() {
  [ -n "$(funnel_url)" ] || return 1
  "$TS" funnel status --json 2>/dev/null \
    | grep -q "\"Proxy\"[[:space:]]*:[[:space:]]*\"http://127\.0\.0\.1:$PORT\""
}
# Tailscale's own commands want root on macOS unless an operator is set. Setup
# sets one, so after the first run this almost never has to ask for a password.
ts_do() {
  "$TS" "$@" >/dev/null 2>&1 && return 0
  [ -t 0 ] || return 1
  sudo "$TS" "$@" >/dev/null 2>&1
}

# Reconnecting a node that is merely stopped is not what "tailscale up" is for.
# The moment the node has any non-default preference — and setup gives it two,
# a hostname and accept-routes — plain "up" refuses and prints the full command
# it wanted instead. A person reads that and retypes it; a script that only
# wanted to reconnect just sees a failure and reports the address as dead while
# Tailscale sits there waiting to be asked properly. So ask properly: take
# Tailscale's own suggested command and run that.
ts_up() {
  local out flags
  out="$("$TS" up --timeout=30s 2>&1)" && return 0
  flags="$(printf '%s\n' "$out" | sed -n 's/^[[:space:]]*tailscale up //p' | head -1)"
  if [ -n "$flags" ]; then
    # shellcheck disable=SC2086
    "$TS" up $flags >/dev/null 2>&1 && return 0
  fi
  [ -t 0 ] || return 1
  # shellcheck disable=SC2086
  sudo "$TS" up --timeout=30s $flags >/dev/null 2>&1
}
lan_ip() {
  local iface candidate
  for iface in en0 en1 en2; do
    candidate="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    [ -n "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }
  done
  return 1
}

# ------------------------------------------------------------------ ensure ---

# start.command calls this on every launch. A saved https address is worth
# nothing if Tailscale came up stopped or the serve config was cleared, which
# is what a reboot, a Tailscale update, or a signed-out session leaves behind.
# Put it back, say nothing when there is nothing to fix, and never stop the
# board from starting.
if [ "$MODE" = ensure ]; then
  SAVED_URL="$(sed -n 's|^TASQ_PUBLIC_URL=\(https://.*\)|\1|p' "$APP_DIR/.env.local" 2>/dev/null | tail -1)"
  case "$SAVED_URL" in
    *.ts.net) ;;
    *) exit 0 ;;   # not a Tailscale board — nothing of ours to put back
  esac
  [ -n "$TS" ] || { warn "Tailscale is gone from this Mac, so $SAVED_URL will not answer."; exit 0; }

  STATE="$(ts_state)"
  if [ "$STATE" != "Running" ]; then
    case "$STATE" in
      NeedsLogin|NeedsMachineAuth)
        warn "Tailscale is signed out, so $SAVED_URL will not answer."
        info "Sign back in with: bash setup/tailscale.sh"
        exit 0 ;;
    esac
    step "Tailscale is not connected — reconnecting it"
    ts_up || true
    for _ in $(seq 1 20); do
      [ "$(ts_state)" = "Running" ] && break
      sleep 1
    done
    if [ "$(ts_state)" != "Running" ]; then
      warn "Tailscale would not connect, so $SAVED_URL will not answer."
      info "Open the Tailscale app once (Applications → Tailscale), then run:"
      info "  bash setup/tailscale.sh --ensure"
      exit 0
    fi
    ok "Tailscale is up"
  fi

  if ! funnel_serves_port; then
    step "The public address was not published — publishing it again"
    ts_do funnel --bg "$PORT" || true
    for _ in $(seq 1 30); do
      funnel_serves_port && break
      sleep 2
    done
    if ! funnel_serves_port; then
      warn "Could not publish port $PORT, so $SAVED_URL will not answer."
      info "Run the full setup again: bash setup/tailscale.sh"
      exit 0
    fi
    ok "Published again"
  fi

  # The address follows the machine name, and the machine name can be changed
  # from the admin console. Keep .env.local honest rather than handing phones
  # an address that stopped existing.
  LIVE_URL="$(funnel_url)"
  if [ -n "$LIVE_URL" ] && [ "$LIVE_URL" != "$SAVED_URL" ]; then
    # Writing .env.local as root would leave it owned by root, and start.command
    # appends to that file as the shop user. Leave it to the next hands-on run.
    if [ "$(id -u)" -eq 0 ]; then
      warn "The public address is now $LIVE_URL but .env.local still says $SAVED_URL."
      info "Run 'bash setup/tailscale.sh' as yourself to write the new one in."
      exit 0
    fi
    ORIGINS="${LIVE_URL#https://}"
    IP="$(lan_ip || true)"
    [ -n "$IP" ] && ORIGINS="$ORIGINS,$IP:$PORT"
    set_env TASQ_PUBLIC_URL "$LIVE_URL"
    set_env TASQ_ALLOWED_ORIGINS "$ORIGINS"
    warn "The public address changed to $LIVE_URL — phones need the new one."
  fi
  exit 0
fi

# -------------------------------------------------------------------- boot ---

BOOT_LABEL=com.tasq.tailscale
BOOT_PLIST="/Library/LaunchDaemons/$BOOT_LABEL.plist"
BOOT_HELPER="/Library/Application Support/Tasq/tailscale-keepalive.sh"
BOOT_LOG="/Library/Logs/Tasq/tailscale.log"
BOOT_INTERVAL="${TASQ_TAILSCALE_INTERVAL:-300}"

boot_installed() { launchctl print "system/$BOOT_LABEL" >/dev/null 2>&1; }

# The launchd job cannot read this repo — a board kept in Documents, Desktop or
# Downloads is "Operation not permitted" to anything launchd starts, and that is
# a supported place to keep it. So --boot writes a standalone copy of the small
# amount of logic the job needs somewhere launchd is allowed to read, with the
# port and the CLI's location already filled in.
write_boot_helper() {
  local tmp; tmp="$(mktemp)"
  cat > "$tmp" <<HELPER
#!/bin/bash
# Keeps the Tasq board's public https address alive.
#
# GENERATED by setup/tailscale.sh --boot. Edit that script and run --boot again;
# anything changed here is overwritten. Run by /Library/LaunchDaemons/$BOOT_LABEL.plist
# at boot and every $BOOT_INTERVAL seconds.

TS="$TS"
PORT="$PORT"
LOG="$BOOT_LOG"

mkdir -p "\$(dirname "\$LOG")" 2>/dev/null || true
log() { printf '%s %s\n' "\$(date '+%Y-%m-%d %H:%M:%S')" "\$1" >> "\$LOG" 2>/dev/null || true; }

# A log nobody rotates is a log that eventually fills the disk.
if [ -f "\$LOG" ] && [ "\$(wc -l < "\$LOG" 2>/dev/null || echo 0)" -gt 2000 ]; then
  tail -n 500 "\$LOG" > "\$LOG.tmp" 2>/dev/null && mv "\$LOG.tmp" "\$LOG"
fi

[ -x "\$TS" ] || { log "tailscale is not at \$TS any more — re-run setup/tailscale.sh"; exit 0; }

state()   { "\$TS" status --json 2>/dev/null | sed -n 's/.*"BackendState"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1; }
serving() { "\$TS" funnel status --json 2>/dev/null | grep -q "\"Proxy\"[[:space:]]*:[[:space:]]*\"http://127\.0\.0\.1:\$PORT\""; }

S="\$(state)"
if [ "\$S" != Running ]; then
  case "\$S" in
    NeedsLogin|NeedsMachineAuth)
      log "signed out of Tailscale — the address is down until someone runs setup/tailscale.sh"
      exit 0 ;;
  esac
  log "node is \${S:-unreachable} — bringing it up"
  # Plain "up" refuses on a node with non-default prefs (this one has a
  # hostname) and prints the command it wanted. Run that.
  OUT="\$("\$TS" up --timeout=30s 2>&1)" || {
    FLAGS="\$(printf '%s\\n' "\$OUT" | sed -n 's/^[[:space:]]*tailscale up //p' | head -1)"
    [ -n "\$FLAGS" ] && "\$TS" up \$FLAGS >/dev/null 2>&1 || true
  }
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ "\$(state)" = Running ] && break
    sleep 2
  done
  if [ "\$(state)" != Running ]; then
    log "node would not come up"
    exit 0
  fi
  log "node is up"
fi

if ! serving; then
  log "funnel is not serving port \$PORT — republishing"
  "\$TS" funnel --bg "\$PORT" >/dev/null 2>&1 || true
  if serving; then log "funnel republished"; else log "funnel would not start"; fi
fi
HELPER
  sudo install -d -o root -g wheel -m 755 "$(dirname "$BOOT_HELPER")" || { rm -f "$tmp"; return 1; }
  sudo install -d -o root -g wheel -m 755 "$(dirname "$BOOT_LOG")" || { rm -f "$tmp"; return 1; }
  sudo install -o root -g wheel -m 755 "$tmp" "$BOOT_HELPER" || { rm -f "$tmp"; return 1; }
  rm -f "$tmp"
  return 0
}

install_boot_job() {
  [ -n "$TS" ] || { warn "Tailscale is not installed, so there is nothing to keep running."; return 1; }
  [ -f "$APP_DIR/setup/$BOOT_LABEL.plist" ] || { warn "Missing setup/$BOOT_LABEL.plist — cannot install the boot job."; return 1; }
  write_boot_helper || { warn "Could not write $BOOT_HELPER"; return 1; }

  local tmp; tmp="$(mktemp)"
  sed -e "s|__INTERVAL__|$BOOT_INTERVAL|g" "$APP_DIR/setup/$BOOT_LABEL.plist" > "$tmp"
  plutil -lint "$tmp" >/dev/null 2>&1 || { rm -f "$tmp"; warn "The generated launchd job was not valid — not installing it."; return 1; }
  sudo install -o root -g wheel -m 644 "$tmp" "$BOOT_PLIST" || { rm -f "$tmp"; return 1; }
  rm -f "$tmp"

  sudo launchctl bootout "system/$BOOT_LABEL" 2>/dev/null || true
  for _ in $(seq 1 50); do boot_installed || break; sleep 0.2; done
  sudo launchctl bootstrap system "$BOOT_PLIST" || { warn "launchd would not take the job."; return 1; }
  sudo launchctl enable "system/$BOOT_LABEL" 2>/dev/null || true
  return 0
}

if [ "$MODE" = boot ]; then
  step "Keeping the address up by itself"
  info "The Tailscale menu-bar app is what connects this Mac, and it only runs"
  info "when someone opens it. That is why the address dies at a reboot while"
  info "the Mac still looks fine — the Mac reaches the board over the tailnet"
  info "and never touches the public address a phone has to use."
  install_boot_job || die "Could not install the boot job."
  ok "Installed. Tailscale comes up at boot and is re-checked every $BOOT_INTERVAL seconds."
  info "Watch it:  sudo tail -f $BOOT_LOG"
  info "Stop it:   bash setup/tailscale.sh --no-boot"
  exit 0
fi

if [ "$MODE" = noboot ]; then
  step "No longer keeping the address up by itself"
  sudo launchctl bootout "system/$BOOT_LABEL" 2>/dev/null || true
  sudo rm -f "$BOOT_PLIST" "$BOOT_HELPER"
  ok "Removed. Tailscale is back to connecting only when its app is opened."
  exit 0
fi

# --------------------------------------------------------------------- off ---

if [ "$MODE" = off ]; then
  step "Taking the board off the public internet"
  [ -n "$TS" ] || die "Tailscale is not installed here, so nothing is published."
  # Leaving the boot job behind would just republish the funnel within minutes.
  if boot_installed || [ -f "$BOOT_PLIST" ]; then
    sudo launchctl bootout "system/$BOOT_LABEL" 2>/dev/null || true
    sudo rm -f "$BOOT_PLIST"
    ok "Stopped putting it back automatically"
  fi
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
  info "Not installed. Tailscale's own signed installer needs no Apple ID,"
  info "no App Store and no Homebrew."
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
  warn "Not signed in."
  info "Use the SHOP's own Tailscale account, not your personal one — the"
  info "board must not depend on your account still existing in two years."
  info "A browser opens; sign in there, then come back here."
  if [ "$ASSUME_YES" -eq 1 ] || [ ! -t 0 ]; then
    die "Sign-in needs a person at the keyboard. Run this script again without --yes."
  fi
  confirm "Open the sign-in page now?" || die "Stopped. Run this again when you have the shop's Tailscale login."
  sudo "$TS" up || die "Sign-in did not complete."
  "$TS" status >/dev/null 2>&1 || die "Still not signed in. Open the Tailscale app and sign in, then run this again."
  ok "Signed in"
fi

# Letting this script drive Tailscale as the shop owner rather than as root
# means every later launch can put the funnel back without a password prompt.
ts_do set --operator="$(id -un)" || warn "Could not set the Tailscale operator — later starts may ask for the Mac's password."

# ------------------------------------------------------------- machine name --

step "Naming this machine"

# The public address is <machine>.<tailnet>.ts.net, so the machine name IS the
# secret half of the address. "landons-macbook-pro" is a name anyone could
# guess and type; a random one is not. Everything behind it still needs a PIN —
# this only stops the address itself from being an invitation.
#
# Chosen once and remembered, because changing it later changes the address and
# breaks every phone that has the board on its home screen.
HOSTNAME_WANTED="$(sed -n 's|^TASQ_TAILNET_HOST=||p' "$APP_DIR/.env.local" 2>/dev/null | tail -1)"
if [ -z "$HOSTNAME_WANTED" ]; then
  # No 0/o/1/l/i — this gets read off a screen and typed on a phone often
  # enough that look-alike characters are a real cost.
  RAND="$(head -c 1024 /dev/urandom | LC_ALL=C tr -dc 'abcdefghjkmnpqrstuvwxyz23456789' | cut -c1-12)"
  [ "${#RAND}" -eq 12 ] || RAND="$(date +%s)${RANDOM}${RANDOM}"
  HOSTNAME_WANTED="tasq-$RAND"
fi

MACHINE="$(ts_dnsname || true)"
RENAMED=0
case "$MACHINE" in
  "$HOSTNAME_WANTED".*)
    ok "Already named $HOSTNAME_WANTED"
    ;;
  *)
    if ts_do set --hostname="$HOSTNAME_WANTED"; then
      for _ in $(seq 1 20); do
        MACHINE="$(ts_dnsname || true)"
        case "$MACHINE" in "$HOSTNAME_WANTED".*) break ;; esac
        sleep 1
      done
    fi
    case "$MACHINE" in
      "$HOSTNAME_WANTED".*)
        RENAMED=1
        ok "Named $HOSTNAME_WANTED"
        info "Deliberately hard to type. Put it on phones with the QR code in"
        info "Settings rather than reading it out."
        ;;
      *)
        warn "Could not rename it, so the address stays easy to guess."
        info "Rename it at https://login.tailscale.com/admin/machines"
        HOSTNAME_WANTED=""
        ;;
    esac
    ;;
esac
[ -n "$HOSTNAME_WANTED" ] && set_env TASQ_TAILNET_HOST "$HOSTNAME_WANTED"
[ -n "$MACHINE" ] && info "This machine is $MACHINE"

# --------------------------------------------------------------- funnel ------

step "Publishing the board"

warn "This puts port $PORT on the public internet over HTTPS."
info "Anyone with the address reaches the sign-in screen and nothing more."
info "It is also the only way phones get notifications — browsers refuse"
info "them on a plain-http address."

# A funnel published under the old name points at an address that no longer
# exists, so a rename has to take the old one down first.
if [ "$RENAMED" -eq 1 ]; then
  ts_do funnel reset || true
fi

FUNNEL_URL="$(funnel_url || true)"
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
    FUNNEL_URL="$(funnel_url || true)"
    [ -n "$FUNNEL_URL" ] && break
    sleep 2
  done
  [ -n "$FUNNEL_URL" ] || die "Published, but no address appeared. Check: $TS funnel status"
  ok "Public address: $FUNNEL_URL"
fi

# ------------------------------------------------------------ addresses ------

step "Telling the board its addresses"

LAN_IP="$(lan_ip || true)"

ORIGINS="${FUNNEL_URL#https://}"
[ -n "$LAN_IP" ] && ORIGINS="$ORIGINS,$LAN_IP:$PORT"

set_env TASQ_PUBLIC_URL "$FUNNEL_URL"
set_env TASQ_ALLOWED_ORIGINS "$ORIGINS"
set_env TASQ_COOKIE_SECURE true
ok "Phones will be pointed at $FUNNEL_URL"
ok "Accepting requests from: $ORIGINS"

# ----------------------------------------------------------- stay up ---------

step "Keeping it up on its own"

if install_boot_job; then
  ok "Comes up at boot, re-checked every $BOOT_INTERVAL seconds"
  info "Without this the address dies at the next reboot: the menu-bar app is"
  info "what connects this Mac, and nothing opens it for you."
else
  warn "Could not set Tailscale to come up on its own."
  info "The address will stop at the next reboot."
  info "Try again with: bash setup/tailscale.sh --boot"
fi

if launchctl print system/com.tasq.server >/dev/null 2>&1; then
  sudo launchctl kickstart -k system/com.tasq.server >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do
    curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login" 2>/dev/null && break
    sleep 1
  done
  ok "Restarted the board so it picks up the new settings"
fi

# ---------------------------------------------------------------- after ------

RULE="  ${DIM}────────────────────────────────────────────────${RESET}"

printf '\n%s\n\n' "$RULE"
printf '  %-14s %s%s%s\n' "From anywhere" "$BOLD" "$FUNNEL_URL" "$RESET"
[ -n "$LAN_IP" ] && printf '  %-14s http://%s:%s\n' "At the shop" "$LAN_IP" "$PORT"
printf '\n%s\n\n' "$RULE"

printf '  %sOne thing left, in a browser%s\n' "$BOLD" "$RESET"
info "Open https://login.tailscale.com/admin/machines, find this Mac, and"
info "choose Disable key expiry from its … menu. Without it the key expires"
info "in about six months and the address quietly stops working."

printf '\n  %sLater%s\n' "$BOLD" "$RESET"
info "Take it offline   bash setup/tailscale.sh --off"
info "Check it is up    bash setup/tailscale.sh --ensure"
info "Its log           sudo tail -f $BOOT_LOG"
printf '\n'
