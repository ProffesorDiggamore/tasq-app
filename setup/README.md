# Putting Apex Board on the shop Mac

End to end this is about 30 minutes, most of it waiting for Tailscale to issue a
certificate. Do the steps in order — Funnel needs to be working before push
notifications will.

Everything here assumes one Mac, permanently on, at one of the two shops.

---

## 0. Where to put it

**Do not put the app in `~/Documents`, `~/Desktop`, or `~/Downloads`.**

macOS protects those three folders with TCC, and a LaunchDaemon has no way to
get consent for them — the server will start and then fail with `EPERM` on the
database, which looks like a code bug and is not one. `setup/install.sh` warns
you about this, but it is easier to just start in the right place:

```bash
sudo mkdir -p /Users/Shared/apex-board
sudo chown "$USER":staff /Users/Shared/apex-board
git clone <your-repo> /Users/Shared/apex-board
cd /Users/Shared/apex-board
```

Node 20 or newer is required. `node --version` to check; install from
[nodejs.org](https://nodejs.org) or `brew install node` if it is missing.

---

## 1. Configure and build

```bash
cp .env.example .env.local
```

Fill in `.env.local`. Two values must be generated:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

goes in `SESSION_SECRET`, and:

```bash
node scripts/generate-vapid.mjs
```

prints the three `VAPID_*` lines. **Generate the VAPID keys once and keep them.**
Regenerating invalidates every phone's subscription and everyone has to turn
notifications on again.

Then:

```bash
npm ci
npm run build
npm run verify     # 182 checks; all should pass before you go further
```

---

## 2. Install the launchd jobs

```bash
sudo setup/install.sh
```

This installs two jobs into `/Library/LaunchDaemons` and starts them:

| Job | What it does |
| --- | --- |
| `com.apexboard.server` | Runs the board on port 4744, restarts it if it dies, starts it at boot |
| `com.apexboard.backup` | Copies the database to `backups/` at 03:30 every night |

Check it came up:

```bash
launchctl print system/com.apexboard.server | head -20
tail -f logs/server.log
curl -I http://localhost:4744/login
```

### Why a LaunchDaemon and not a LaunchAgent

A **LaunchAgent** (`~/Library/LaunchAgents`) only runs once a user has logged
in. After a power cut the Mac would sit at the login window and the board would
be down until somebody walked over and typed a password — which is exactly the
failure this is supposed to survive. You can paper over it by enabling
automatic login, but that trades a locked Mac for an unlocked one in a shop.

A **LaunchDaemon** (`/Library/LaunchDaemons`) runs at boot, before any login.
That is what the "survives reboots with nobody clicking anything" requirement
needs, so that is what `install.sh` sets up. The plist sets `UserName` to your
account so the database and backups stay owned by a real user rather than root.

The cost is the TCC restriction in step 0, and no access to the login keychain —
neither of which this app needs.

### Managing the service

Current macOS uses `bootstrap`/`bootout`, not the deprecated `load`/`unload`:

```bash
# stop
sudo launchctl bootout system/com.apexboard.server

# start
sudo launchctl bootstrap system /Library/LaunchDaemons/com.apexboard.server.plist

# restart in place (what deploy.sh uses)
sudo launchctl kickstart -k system/com.apexboard.server

# is it running, and what was the last exit code?
launchctl print system/com.apexboard.server | grep -E 'state|last exit'
```

---

## 3. Stop the Mac sleeping

A sleeping Mac is an offline board. On a desktop Mac:

```bash
sudo pmset -a sleep 0
sudo pmset -a disksleep 0
sudo pmset -a womp 1        # wake on network access
```

On a laptop, also:

```bash
sudo pmset -a disablesleep 1
```

**Closing a laptop lid takes the board down** even with `disablesleep`, unless
it is connected to an external display and power. If the shop Mac is a laptop,
leave it open, or use a desktop.

Confirm with `pmset -g`.

---

## 4. Tailscale Funnel (off-site access + HTTPS)

Web Push and PWA install both require real HTTPS. Funnel provides it free, with
a certificate Apple and Google already trust — a self-signed certificate will
not work for either.

```bash
brew install --cask tailscale
open -a Tailscale
```

Sign in, then from the terminal:

```bash
# Confirm the machine is on your tailnet and note its name
tailscale status

# Expose port 4744 to the public internet over HTTPS, and keep it exposed
sudo tailscale funnel --bg 4744

# Check
tailscale funnel status
```

`funnel status` prints the public hostname, something like
`https://shop-mac.tailXXXX.ts.net`. That is the address the crew uses.

If Funnel refuses to start, it is almost always one of two things in the
[admin console](https://login.tailscale.com/admin):

1. **HTTPS certificates** are not enabled — DNS → HTTPS Certificates → Enable.
2. **Funnel is not permitted** by your ACL. Add the node attribute:

   ```jsonc
   "nodeAttrs": [
     { "target": ["autogroup:member"], "attr": ["funnel"] }
   ]
   ```

Once it works, put the hostname in `.env.local`:

```
APEX_PUBLIC_URL=https://shop-mac.tailXXXX.ts.net
APEX_ALLOWED_ORIGINS=shop-mac.tailXXXX.ts.net,192.168.1.50:4744
```

`APEX_ALLOWED_ORIGINS` should list the Funnel hostname **and** the LAN address
(step 5), or server actions will be rejected from one of them. Restart after
editing:

```bash
sudo launchctl kickstart -k system/com.apexboard.server
```

Funnel survives reboots on its own — `--bg` registers it with the Tailscale
daemon. Re-check `tailscale funnel status` after the first reboot to be sure.

---

## 5. LAN fallback

The same server is already reachable on the shop network. Find the Mac's
address:

```bash
ipconfig getifaddr en0    # Wi-Fi
ipconfig getifaddr en1    # Ethernet, if wired
```

Then `http://192.168.1.50:4744` (with your address) works from any phone,
tablet or laptop on the shop Wi-Fi.

Give the Mac a **DHCP reservation** on the router, or the address will change
and the bookmark will break.

### What works without internet

| | Funnel (`https://…ts.net`) | LAN (`http://192.168…`) |
| --- | --- | --- |
| Internet down, shop network up | ✗ | ✓ |
| Off-site | ✓ | ✗ |
| Push notifications | ✓ | ✗ |
| Install to home screen | ✓ | ✗ (needs HTTPS) |

**The board itself does not need the internet. Notifications and off-site access
do.** When the internet drops, everyone at the shop can keep using the LAN
address; nothing is lost, and the two are the same database.

Two things worth knowing about using both addresses:

- Signing in on the Funnel hostname and on the LAN address are **two separate
  sessions** — cookies are per-host. Each device will ask for a PIN once per
  address.
- The session cookie is deliberately **not** marked `Secure`, because a `Secure`
  cookie is never sent over plain HTTP and the LAN fallback would never keep
  anyone signed in. If you ever decide to serve the board over HTTPS only, set
  `APEX_COOKIE_SECURE=true`.

---

## 6. Install it on phones

Open Settings in the board — there is a QR code with the current address. Point
a phone camera at it, then:

- **iPhone:** Share → Add to Home Screen. This is not optional if you want
  notifications: iOS only allows Web Push for home-screen apps, on iOS 16.4 or
  newer. The board shows these instructions itself, twice, then stops.
- **Android:** Chrome offers "Install app" in its menu, or the board prompts.

After it opens from the home screen, sign in and accept the notification prompt.

---

## 7. Backups

The nightly job writes `backups/apex-YYYY-MM-DD.db` at 03:30 and keeps 30 days.
It uses sqlite3's `.backup`, not `cp` — the board is live and in WAL mode, so a
raw copy can catch the file mid-write and produce something that restores to
garbage.

Every backup is integrity-checked before it replaces the day's file, so a
corrupt read leaves yesterday's good backup alone.

Run one by hand any time:

```bash
setup/backup.sh
```

To restore:

```bash
sudo launchctl bootout system/com.apexboard.server
cp backups/apex-2026-08-17.db data/apex.db
rm -f data/apex.db-wal data/apex.db-shm
sudo launchctl bootstrap system /Library/LaunchDaemons/com.apexboard.server.plist
```

These backups live on the same disk as the database, which protects you from a
bad deploy or a mistaken delete, **not** from the disk dying. If the shop can't
lose this data, point Time Machine or a cloud sync folder at `backups/` too.

---

## 8. Updating

```bash
cd /Users/Shared/apex-board
setup/deploy.sh
```

That backs up the database, pulls, installs, builds, runs the 182 verification
checks, and only then restarts the service — so a broken build leaves the
running board alone.

---

## Troubleshooting

**Board is down after a reboot**
`launchctl print system/com.apexboard.server | grep -E 'state|last exit'`.
An exit code of 78 means `.env.local` or the build is missing.

**`EPERM` on the database**
The app is in a TCC-protected folder. See step 0.

**Notifications work on Android but not iPhone**
The iPhone is using Safari, not the home-screen app. iOS only allows push from
an installed PWA on 16.4+.

**Nobody gets notifications**
`grep VAPID logs/server.log`. If the keys are missing the server says so at
startup and quietly runs with notifications off.

**Server actions fail from one address but not the other**
`APEX_ALLOWED_ORIGINS` is missing that host. Add it and restart.

**Funnel worked, then stopped**
`tailscale funnel status`. If empty, re-run `sudo tailscale funnel --bg 4744`,
and check the machine's key has not expired in the admin console — expiry
disables Funnel silently.
