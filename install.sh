#!/bin/bash
#
# Tasq — install on a Mac that has nothing on it.
#
#   curl -fsSL https://tasq.install | bash
#
# Installs Apple's command line tools and Node if they are missing, downloads
# the app, and hands over to setup/bootstrap.sh, which does the rest: keys,
# build, background service, nightly backup, and a public HTTPS address.
#
# Run as a normal admin user, not with sudo. It asks for the Mac's password at
# the steps that genuinely need it.
#
# No Homebrew. Homebrew would need the same command line tools this installs,
# plus a few minutes of its own, to end up at the same Node — so it is one more
# thing to go wrong for nothing.
#
set -euo pipefail

REPO="${TASQ_REPO:-https://github.com/ProffesorDiggamore/tasq-app.git}"
BRANCH="${TASQ_BRANCH:-main}"
DEST="${TASQ_DEST:-/Users/Shared/tasq}"

# Piped through curl, this script's stdin is the download, not the keyboard, so
# every prompt from here down (including bootstrap's) would read end-of-file
# and answer itself. Point stdin back at the terminal.
# /dev/tty exists even with no controlling terminal, and only fails on open, so
# test by opening it before committing exec to it.
if : </dev/tty 2>/dev/null; then exec </dev/tty; fi

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

printf '%s\n' "${BOLD}Installing Tasq${RESET}"

# ------------------------------------------------------------- the machine ---

step "Checking this Mac"

[ "$(uname -s)" = "Darwin" ] || die "Tasq's installer is for macOS."
[ "$(id -u)" -eq 0 ] && die "Don't run this with sudo. Run it as yourself; it asks for the password when it needs one."
ok "macOS $(sw_vers -productVersion) on $(uname -m)"

id -Gn | tr ' ' '\n' | grep -qx admin \
  || die "This account cannot install software on this Mac. Log in as an administrator, or ask whoever manages these machines to run this."
ok "$(id -un) can install software"

# -------------------------------------------------------- command line tools -

step "Apple's command line tools"

# Probe with xcode-select rather than by running git: macOS ships git as a stub
# that answers a version query by throwing an install dialog onto the Mac's own
# screen, which helps nobody when this is running over SSH.
if [ -d "$(xcode-select -p 2>/dev/null || true)" ] && git --version >/dev/null 2>&1; then
  ok "Already installed ($(git --version))"
else
  info "Not installed. These are free, from Apple, and need no Apple ID."
  info "Takes a few minutes and prints very little while it works."
  # The sentinel makes softwareupdate offer the tools as a normal update, which
  # is the only way in without a person clicking a dialog on the Mac itself.
  SENTINEL=/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress
  sudo touch "$SENTINEL"
  LABEL="$(softwareupdate -l 2>/dev/null | grep -E '^\s*\*.*Command Line' | tail -1 | sed -e 's/^[^C]*//' -e 's/[[:space:]]*$//')"
  if [ -n "$LABEL" ]; then
    info "Installing: $LABEL"
    sudo softwareupdate -i "$LABEL" >/dev/null || warn "softwareupdate could not install them."
  else
    warn "Apple is not offering them as an update on this machine."
  fi
  sudo rm -f "$SENTINEL"
  git --version >/dev/null 2>&1 \
    || die "Still no working git. Sit at this Mac, run 'xcode-select --install', click through the dialog, then run this again."
  ok "Installed ($(git --version))"
fi

# -------------------------------------------------------------------- node ---

step "Node"

if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 20 ]; then
  ok "Already installed ($(node -v))"
else
  command -v node >/dev/null 2>&1 && info "Node $(node -v) is too old — replacing it." || info "Not installed."
  INDEX="$(curl -fsS https://nodejs.org/dist/index.json 2>/dev/null || true)"
  VER="$(printf '%s' "$INDEX" | tr '}' '\n' | grep '"lts":"' | head -1 | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
  [ -n "$VER" ] || die "Could not reach nodejs.org. Check the internet connection."

  PKG="$(mktemp -d)/node.pkg"
  info "Downloading Node $VER from nodejs.org"
  curl -fL --progress-bar -o "$PKG" "https://nodejs.org/dist/$VER/node-$VER.pkg" || die "The Node download failed."

  # Never hand root an installer macOS will not vouch for.
  spctl -a -vv -t install "$PKG" >/dev/null 2>&1 \
    || die "That installer did not pass macOS's signature check. Delete it and install Node by hand from https://nodejs.org"

  sudo installer -pkg "$PKG" -target / >/dev/null || die "The Node installer failed."
  rm -f "$PKG"
  export PATH="/usr/local/bin:$PATH"
  hash -r
  command -v node >/dev/null 2>&1 || die "Node installed but is not on the PATH. Open a new terminal and run this again."
  ok "Installed ($(node -v))"
fi

# ----------------------------------------------------------------- the app ---

step "The app"

# Not Documents, Desktop or Downloads: macOS blocks background services from
# reading those, and the board runs as one.
if [ -d "$DEST/.git" ]; then
  info "Already at $DEST — updating it instead."
  git -C "$DEST" remote set-url origin "$REPO"
  git -C "$DEST" fetch --quiet origin "$BRANCH" || die "Could not reach GitHub."
  if [ -n "$(git -C "$DEST" status --porcelain --untracked-files=no)" ]; then
    die "$DEST has local edits. Commit or discard them there, then run this again."
  fi
  git -C "$DEST" checkout --quiet "$BRANCH"
  git -C "$DEST" reset --hard --quiet "origin/$BRANCH"
  ok "Updated to $(git -C "$DEST" log --oneline -1)"
elif [ -e "$DEST" ]; then
  die "$DEST already exists but is not a Tasq checkout. Move or remove it, then run this again."
else
  mkdir -p "$(dirname "$DEST")"
  git clone --quiet --branch "$BRANCH" "$REPO" "$DEST" || die "Could not download the app from $REPO"
  ok "Downloaded to $DEST"
fi

chmod +x "$DEST"/setup/*.sh "$DEST"/*.command 2>/dev/null || true

# ------------------------------------------------------------------- hand off -

step "Setting it up"
info "Everything from here is setup/bootstrap.sh — keys, build, background"
info "service, nightly backup, and a public address for phones."

cd "$DEST"
exec bash setup/bootstrap.sh "$@"
