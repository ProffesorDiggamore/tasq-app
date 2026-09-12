# Shipping a Tasq board to a customer

Everything below is already built and tested. This is the runbook, in order.

## 0. One-time, for you (skip if done)

- Cloudflare account + one domain (e.g. `tasqboards.com`). Full steps in
  [CLOUDFLARE-SETUP.md](./CLOUDFLARE-SETUP.md).

## 1. On the shop Mac

```bash
bash setup/bootstrap.sh
```

It checks the machine, moves the app out of `~/Documents` if needed, generates
the secrets, builds, runs all checks, installs the background service + nightly
backup, offers to stop the Mac sleeping, and sets up public HTTPS
(`--tunnel=cloudflare` or `--tunnel=tailscale`). Run it as yourself, not `sudo`.

If the customer has no domain and you don't want to give them a subdomain:
`--tunnel=tailscale` (works with no domain, but each device re-auths every ~180
days unless you disable key expiry in the Tailscale admin console).

## 2. Hand over the setup code

On first boot the server prints a one-time code in its window and writes it to
`data/setup-code.txt`. Give that to the owner. They open `/setup`, enter it,
name the board, and make themselves an admin with a 4-digit PIN. The code dies
the moment they finish. On the very next boot the guided tour runs for them.

## 3. Phones

Each person opens the **https** address, taps their name, sets a PIN, then
Add to Home Screen, then allows notifications when asked. Settings → Get it on
a phone has a QR code.

Notifications only work over the https address, not the LAN one — that is a
browser rule, not a Tasq one.

## 3a. Optional: lock the board to approved devices

Only worth it once the board is on the open internet through a tunnel — on the
shop LAN the front door already does this job.

Settings → **Devices** → *Approved devices only*. Turning it on approves the
browser it was turned on from, so the owner cannot lock themselves out with one
tap. Every other browser that reaches the address lands on a "waiting to be let
in" screen — which names nothing about the shop — and appears in that list for
the owner to approve, rename, block, or ignore.

A "device" is one browser profile. A private window, a second browser, or
cleared site data all count as a new one, so the owner will approve each
person's phone once and then rarely think about it again.

If they ever revoke their last approved device, the way back in is on the shop
Mac:

```bash
npm run devices              # list
npm run devices -- approve 3 # let #3 in
npm run devices -- off       # turn the whole thing off
```

## 3b. Optional: let the board update itself

Worth doing on any board you will keep working on after handover — it turns a
shipped update into `git push` and nothing else.

```bash
bash setup/autoupdate.sh --setup
```

It makes a read-only deploy key, prints the public half for you to paste into
the repo's **Settings → Deploy keys** (leave *Allow write access* unchecked),
switches `origin` to SSH so that key can be used, asks which branch this board
should follow, and schedules the check.

From then on, pushing to that branch is the whole deployment. The shop Mac
fetches on its own, and only when there is something new does it back up the
database, install any new dependencies, build, run `npm run verify`, and
restart. A failed build, a failed check suite, or a board that does not answer
afterwards all roll it back to the last version that worked — the commit, the
`node_modules`, and the build together — so a bad push cannot leave a shop
without a board.

Nothing reaches into the shop from outside: the Mac pulls. It does need to be
a `git clone`, not a copied folder, and it refuses to run while the working
tree has local edits rather than overwriting somebody's fix.

```bash
bash setup/autoupdate.sh --status   # what it follows, and the last few runs
bash setup/autoupdate.sh --now      # do not wait for the next check
bash setup/autoupdate.sh --off      # stop; board stays on its current version
tail -f logs/autoupdate.log
```

To push an update and watch it land, with both Macs on the same tailnet:

```bash
git push origin main && ssh <shop-mac> 'cd /Users/Shared/tasq && setup/autoupdate.sh --now'
```

## 4. Later: sending an update by hand

For a board without auto-update: zip the new app folder (minus `node_modules`, `data`, `.env.local`), name it
`Tasq-update`, send it. The owner drops it on the Desktop and double-clicks
**`update.command`**. It backs up their data, builds the new version in a
staging copy, swaps it in only if the build is green, smoke-boots it, and rolls
back automatically if anything fails. Their users, PINs, and history are never
touched.

---

## State of the code (as of this checklist)

- `npm run build` — passes
- `npm run typecheck` — passes, no exclusions
- `npm run verify` — all 12 suites pass (auth, onboarding, tasks, scheduler,
  notify, push, history-extras, security, editing, payouts, devices, setup)
- Boot smoke test — `/login` 200, security headers present, HSTS correctly
  absent on plain HTTP
- `update.command` — happy path and rollback path both tested end to end

### Known, non-blocking

- All 66 changed files are uncommitted on `main`. Commit before shipping so
  `update.command`'s git fallback and any rollback have a clean baseline.
- `setup/cloudflared.sh` works in tests but has not been run against a real
  Cloudflare account — do a dry run before the first paying customer.
- Rate limits on setup-code guessing / login name-walking key off
  `X-Forwarded-For`, which is only trustworthy behind the tunnel. The
  per-account PIN lockout (`lib/auth/throttle.ts`) is the real guarantee and is
  not bypassable. See README "Notes on the two access paths".
- Error codes: every code the board can show is in
  [ERROR-CODES.md](./ERROR-CODES.md). A customer reads you the code, you look
  up the fix.
