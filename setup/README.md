# Putting Tasq on the shop Mac

## Just do it for me

```bash
bash setup/bootstrap.sh
```

That is the whole install. It takes about ten minutes, most of it waiting for a
certificate, and it asks before anything consequential.

It will:

1. Check this Mac has what it needs (Node 20+, sqlite3) and stop with a plain
   explanation if not.
2. Move the app out of Documents/Desktop/Downloads if that is where it is —
   macOS blocks background services from reading those, and the board would
   start and then fail with a permissions error.
3. Generate the session secret and the notification keys, and write them to
   `.env.local`.
4. Install dependencies, build, and run the 257 checks.
5. Offer to stop the Mac sleeping.
6. Install the background service and the nightly backup, and start them.
7. Offer to turn on public HTTPS access — a **Cloudflare Tunnel** (needs a
   domain, never expires) or **Tailscale Funnel** (no domain) — and wait for
   the certificate.
8. Work out the shop-network address, tell the board about both addresses, and
   restart.
9. Print the addresses and what to do next.

**Run it as yourself, not with `sudo`.** It asks for your password at the three
steps that need root. Running the whole thing as root would leave the database
and `node_modules` owned by root, and the server would not start afterwards.

Safe to run again at any time. It never regenerates keys that already exist,
never touches the database, and tells you what it found.

```bash
bash setup/bootstrap.sh --yes                  # no prompts, for a rebuild
bash setup/bootstrap.sh --tunnel=cloudflare    # use a Cloudflare Tunnel
bash setup/bootstrap.sh --tunnel=tailscale     # use Tailscale Funnel
bash setup/bootstrap.sh --tunnel=none          # shop network only, no public access
bash setup/bootstrap.sh --skip-power           # leave the sleep settings alone
```

`--skip-funnel` still works as an alias for `--tunnel=none`. Cloudflare setup
needs a terminal and a browser, so `--yes` unattended runs skip it — run
`setup/cloudflared.sh` by hand afterward.

### When it finishes

1. Open the board and tap **Chris** to set the first PIN.
2. **Settings → Get it on a phone** has a QR code. Point each phone's camera at
   it, then **Share → Add to Home Screen**.
3. Open it from the home screen and allow notifications.

Step 2 is not optional on iPhone: iOS only allows notifications for a web app
that has been added to the home screen, on iOS 16.4 or newer.

### Afterwards

| | |
| --- | --- |
| Update it | double-click `update.command` in the app folder (see below) |
| Watch the log | `tail -f logs/server.log` |
| Is it running | `launchctl print system/com.tasq.server \| grep state` |
| Back up now | `setup/backup.sh` |
| Remove it all | `setup/uninstall.sh` — leaves your data alone |

---

## What it did, and how to do it by hand

Read on if something went wrong, or if you would rather drive it yourself.

### Where the app lives

**Not `~/Documents`, `~/Desktop`, or `~/Downloads`.** macOS protects those three
with TCC, and a LaunchDaemon has no way to get consent for them — the server
starts and then fails with `EPERM` on the database, which looks like a code bug
and is not one. `/Users/Shared/tasq` is a good home.

```bash
sudo mkdir -p /Users/Shared/tasq
sudo chown "$USER":staff /Users/Shared/tasq
git clone <your-repo> /Users/Shared/tasq
cd /Users/Shared/tasq
```

### Secrets

```bash
cp .env.example .env.local
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # SESSION_SECRET
node scripts/generate-vapid.mjs                                                  # VAPID_*
```

**Generate the VAPID keys once and keep them.** Regenerating invalidates every
phone's subscription and everyone has to turn notifications on again.

### Build

```bash
npm ci
npm run build
npm run verify     # 257 checks; all should pass before you go further
```

### The launchd jobs

```bash
sudo setup/install.sh
```

Two jobs go into `/Library/LaunchDaemons`:

| Job | What it does |
| --- | --- |
| `com.tasq.server` | Runs the board on port 4744, restarts it if it dies, starts it at boot |
| `com.tasq.backup` | Copies the database to `backups/` at 03:30 every night |

Check it came up:

```bash
launchctl print system/com.tasq.server | head -20
tail -f logs/server.log
curl -I http://localhost:4744/login
```

#### Why a LaunchDaemon and not a LaunchAgent

A **LaunchAgent** (`~/Library/LaunchAgents`) only runs once a user has logged
in. After a power cut the Mac would sit at the login window and the board would
be down until somebody walked over and typed a password — exactly the failure
this is meant to survive. You can paper over it with automatic login, but that
trades a locked Mac for an unlocked one in a shop.

A **LaunchDaemon** (`/Library/LaunchDaemons`) runs at boot, before any login.
The plist sets `UserName` to your account so the database and backups stay owned
by a real user rather than root.

The cost is the TCC restriction above, and no access to the login keychain —
neither of which this app needs.

#### Managing the service

Current macOS uses `bootstrap`/`bootout`, not the deprecated `load`/`unload`:

```bash
sudo launchctl bootout system/com.tasq.server
sudo launchctl bootstrap system /Library/LaunchDaemons/com.tasq.server.plist
sudo launchctl kickstart -k system/com.tasq.server     # restart in place
launchctl print system/com.tasq.server | grep -E 'state|last exit'
```

### Sleep

A sleeping Mac is an offline board.

```bash
sudo pmset -a sleep 0
sudo pmset -a disksleep 0
sudo pmset -a womp 1          # wake on network access
sudo pmset -a disablesleep 1  # laptops only
```

**Closing a laptop lid takes the board down** even with `disablesleep`, unless
it is on an external display and power. If the shop Mac is a laptop, leave it
open, or use a desktop. Confirm with `pmset -g`.

### Public HTTPS — Cloudflare Tunnel or Tailscale Funnel

Web Push and PWA install both need real HTTPS with a certificate Apple and
Google already trust. Self-signed will not work. Two free ways to get one:

| | Cloudflare Tunnel | Tailscale Funnel |
| --- | --- | --- |
| Domain needed | Yes (any domain on a Cloudflare account) | No |
| Expires | Never | Device key every ~180 days unless disabled |
| Router port to open | No | No |
| Walkthrough | **[CLOUDFLARE.md](./CLOUDFLARE.md)** | **[TAILSCALE.md](./TAILSCALE.md)** |
| Script | `setup/cloudflared.sh` | built into `bootstrap.sh` |

The rest of this section covers Tailscale; the Cloudflare path is in
[CLOUDFLARE.md](./CLOUDFLARE.md).

```bash
brew install --cask tailscale
open -a Tailscale        # sign in
sudo tailscale up
sudo tailscale funnel --bg 4744
tailscale funnel status
```

`funnel status` prints the public hostname, something like
`https://shop-mac.tailXXXX.ts.net`.

If Funnel refuses to start, it is almost always one of two things in the
[admin console](https://login.tailscale.com/admin):

1. **HTTPS certificates** are not enabled — DNS → HTTPS Certificates → Enable.
2. **Funnel is not permitted** by your ACL:

   ```jsonc
   "nodeAttrs": [
     { "target": ["autogroup:member"], "attr": ["funnel"] }
   ]
   ```

Then put the addresses in `.env.local`:

```
TASQ_PUBLIC_URL=https://shop-mac.tailXXXX.ts.net
TASQ_ALLOWED_ORIGINS=shop-mac.tailXXXX.ts.net,192.168.1.50:4744
```

`TASQ_ALLOWED_ORIGINS` must list the Funnel hostname **and** the LAN address, or
server actions get rejected from one of them. Restart after editing.

Funnel survives reboots on its own — `--bg` registers it with the Tailscale
daemon. Re-check after the first reboot to be sure.

### LAN fallback

```bash
ipconfig getifaddr en0    # Wi-Fi
ipconfig getifaddr en1    # Ethernet
```

Then `http://192.168.1.50:4744` works from anything on the shop Wi-Fi. Give the
Mac a **DHCP reservation** on the router, or the address will change.

| | Funnel (`https://…ts.net`) | LAN (`http://192.168…`) |
| --- | --- | --- |
| Internet down, shop network up | ✗ | ✓ |
| Off-site | ✓ | ✗ |
| Push notifications | ✓ | ✗ |
| Install to home screen | ✓ | ✗ (needs HTTPS) |

**The board itself does not need the internet. Notifications and off-site access
do.** When the internet drops, everyone at the shop keeps using the LAN address;
it is the same database.

Two things worth knowing about using both addresses:

- Signing in on the Funnel hostname and on the LAN address are **two separate
  sessions** — cookies are per-host. Each device asks for a PIN once per address.
- The session cookie is deliberately **not** `Secure`, because a `Secure` cookie
  is never sent over plain HTTP and the LAN fallback would never keep anyone
  signed in. For an HTTPS-only setup, set `TASQ_COOKIE_SECURE=true`.

### Backups

The nightly job writes `backups/tasq-YYYY-MM-DD.db` at 03:30 and keeps 30 days.
It uses sqlite3's `.backup`, not `cp` — the board is live and in WAL mode, so a
raw copy can catch the file mid-write and produce something that restores to
garbage. Every backup is integrity-checked before it replaces the day's file.

Set `TASQ_BACKUP_OFFSITE_DIR` in `.env.local` to a synced folder (iCloud Drive,
Dropbox, a NAS mount) and every night's verified backup is copied there too, on
the same 30-day retention. `bootstrap.sh` offers the iCloud Drive location
automatically.

```bash
setup/backup.sh          # run one now
```

To restore:

```bash
sudo launchctl bootout system/com.tasq.server
cp backups/tasq-2026-08-17.db data/tasq.db
rm -f data/tasq.db-wal data/tasq.db-shm
sudo launchctl bootstrap system /Library/LaunchDaemons/com.tasq.server.plist
```

These backups sit on the same disk as the database, which protects you from a
bad deploy or a mistaken delete, **not** from the disk dying. If the shop cannot
lose this data, point Time Machine or a cloud sync folder at `backups/` too.

### Updating

**For the shop owner — no terminal needed.** When Landon sends a new version
(a folder called `Tasq-update`, or a `Tasq-update` zip), put it on the Desktop
or in Downloads, then double-click **`update.command`** in the app folder. It
backs up your data first, installs the new version, checks it starts, and
leaves the board running the way it was. If anything goes wrong it puts your
old version back — nothing is lost.

**For developers** (git checkout, terminal):

```bash
setup/deploy.sh
```

Backs up the database, pulls, installs, builds, runs the checks, and only then
restarts — so a broken build leaves the running board alone.

---

## Troubleshooting

**Board is down after a reboot**
`launchctl print system/com.tasq.server | grep -E 'state|last exit'`.
Exit code 78 means `.env.local` or the build is missing.

**`EPERM` on the database**
The app is in a TCC-protected folder. Move it and re-run `setup/bootstrap.sh`.

**Notifications work on Android but not iPhone**
The iPhone is using Safari, not the home-screen app. iOS only allows push from
an installed PWA on 16.4+.

**Nobody gets notifications**
`grep VAPID logs/server.log`. If the keys are missing the server says so at
startup and quietly runs with notifications off.

**Server actions fail from one address but not the other**
`TASQ_ALLOWED_ORIGINS` is missing that host. Add it and restart.

**Funnel worked, then stopped**
`tailscale funnel status`. If empty, re-run `sudo tailscale funnel --bg 4744`,
and check the machine's key has not expired in the admin console — expiry
disables Funnel silently. (Disable key expiry on that machine to stop this
recurring; or use a Cloudflare Tunnel, which has no such clock.)

**Cloudflare Tunnel worked, then stopped**
`launchctl print system/com.tasq.tunnel | grep state` and
`tail -n 40 logs/tunnel.error.log`. Usually the credentials file moved or the
`config.yml` hostname stopped matching the DNS record. See
[CLOUDFLARE.md](./CLOUDFLARE.md).

**Start over without losing data**
`setup/uninstall.sh` then `setup/bootstrap.sh`. The database and backups are
left alone by both.
