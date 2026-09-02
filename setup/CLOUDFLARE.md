# Remote access with a Cloudflare Tunnel

Step-by-step setup for getting the board onto phones, from anywhere, over real
HTTPS — the thing notifications and Add-to-Home-Screen require.

**Why this exists:** browsers only allow push notifications and PWA installs on
an address with a certificate they already trust. A named Cloudflare Tunnel
provides one, free to run, with no port forwarding and nothing that expires.
When the internet is down, the shop falls back to the plain-HTTP network
address (see the end).

**Cloudflare Tunnel vs Tailscale Funnel** — both are free and both work. Pick
Cloudflare if:

- you have (or will register) a domain name — the tunnel needs one, added to a
  Cloudflare account
- you do not want to re-authorise anything every six months. Tailscale expires
  each device's key after ~180 days unless you turn that off; a Cloudflare
  Tunnel has no such clock.

Pick Tailscale if you have no domain and do not want to buy one.
[TAILSCALE.md](./TAILSCALE.md) is that path.

> Setting up a board for someone else's business? Use **their** Cloudflare
> account and **their** domain, not yours — the board must not depend on you
> keeping anything.

---

## What you need

- The Mac the board runs on
- 10 minutes
- A free Cloudflare account
- A domain on that account. If the domain is registered elsewhere, add it to
  Cloudflare (Websites → Add a site) and switch its nameservers as Cloudflare
  tells you — a one-time change at your registrar. A `board.` subdomain is all
  this uses; the rest of the domain is untouched.

`bootstrap.sh` runs all of this for you (`--tunnel=cloudflare`) and asks before
each step — this guide is the manual path and the reference for what the script
does. The script is `setup/cloudflared.sh`; you can run it on its own at any
time.

---

## Step 1 — Install cloudflared

```bash
brew install cloudflared
```

Or download it from
<https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>.

**Check it worked:** `cloudflared --version` prints a version.

## Step 2 — Sign in

```bash
cloudflared tunnel login
```

A browser window opens. Sign in, then pick the domain this board should live
under. cloudflared writes a certificate to `~/.cloudflared/cert.pem`.

## Step 3 — Create the tunnel

```bash
cloudflared tunnel create tasq
```

This makes a tunnel named `tasq` and writes its credentials to
`~/.cloudflared/<UUID>.json`. Run it once — `cloudflared tunnel list` shows it
afterwards.

## Step 4 — Point it at the board

Create `~/.cloudflared/config.yml` (use your own hostname and the UUID from
`cloudflared tunnel list`):

```yaml
tunnel: <UUID>
credentials-file: /Users/you/.cloudflared/<UUID>.json

ingress:
  - hostname: board.yourshop.com
    service: http://localhost:4744
  - service: http_status:404
```

The last rule with no hostname is required — cloudflared refuses a config that
ends on a hostname rule.

```bash
cloudflared tunnel ingress validate
cloudflared tunnel route dns tasq board.yourshop.com
```

`route dns` creates a CNAME under your domain pointing at the tunnel. If it says
the record already exists and it points somewhere else, delete it in the
Cloudflare dashboard (DNS → Records) and run the command again.

## Step 5 — Run it as a service

So the tunnel comes back after a reboot. `setup/install.sh` installs a launchd
job (`com.tasq.tunnel`) automatically once `~/.cloudflared/config.yml` exists:

```bash
sudo setup/install.sh
```

To try it by hand first, without the service:

```bash
cloudflared tunnel run tasq
```

Open `https://board.yourshop.com` — you should see the board's sign-in screen.

**Check the service:**

```bash
launchctl print system/com.tasq.tunnel | grep state
tail -f logs/tunnel.log
```

## Step 6 — Tell the board its addresses

Edit `.env.local` in the board folder (`setup/cloudflared.sh` does this for
you):

```bash
TASQ_PUBLIC_URL=https://board.yourshop.com
TASQ_ALLOWED_ORIGINS=board.yourshop.com,192.168.1.50:4744
```

- `TASQ_PUBLIC_URL` is what Settings QR-codes so people can install the app.
- `TASQ_ALLOWED_ORIGINS` lists both ways in: the tunnel hostname (no `https://`)
  and the shop's network address with its port. Find the network address with
  `ipconfig getifaddr en0`.

Restart the board after editing. Wrong values here do not break sign-in — they
break *actions* (creating tasks and so on) with an "invalid origin" error, so
test by tapping something after signing in.

## Step 7 — Phones

On each phone, open the **https** address, tap your name, set a PIN, then:

- **iPhone:** Share → Add to Home Screen → open from the icon → accept the
  notification prompt.
- **Android:** open in Chrome → menu → Install app → accept notifications.

If a phone says notifications aren't available, it is almost certainly on the
http network address instead of the https one — Settings → Notifications says
which.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `cloudflared tunnel login` never returns | The browser tab did not complete. Close it, re-run, pick the domain. |
| `route dns` says the record exists | A DNS record already owns that hostname. Delete it in the dashboard (DNS → Records) and re-run, or pick another subdomain. |
| Tunnel runs but the hostname 404s | The `hostname:` in `config.yml` does not match the DNS record, or the `service:` port is wrong. It must be `http://localhost:4744`. |
| Board loads but taps fail with origin errors | `TASQ_ALLOWED_ORIGINS` is missing the address you are using. Fix and restart (Step 6). |
| `launchctl print system/com.tasq.tunnel` missing | `~/.cloudflared/config.yml` did not exist when `install.sh` ran. Create it (Step 4), then `sudo setup/install.sh` again. |
| Signed-in on phone but asks again on shop Wi-Fi | Normal — cookies are per-address. The https address and the http address are two sessions. Use the https one day to day. |
| Internet is down | Use the network address (`http://<shop-ip>:4744`). Board works; notifications will not fire until phones are back on https. |

## Living with it

- The tunnel survives reboots — the launchd job starts it at boot and restarts
  it if it drops. Nothing expires; there is no key to renew.
- The public address reaches the sign-in screen only; every action still needs a
  person's PIN. Anyone not added to the board cannot get past it.
- Removing it later: `setup/uninstall.sh` stops the job, then
  `cloudflared tunnel delete tasq` and delete the DNS record in the dashboard.
  The shop network address keeps working.
- Nothing bills unless your Cloudflare plan already does — Tunnels are on the
  free plan.
