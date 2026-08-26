# Remote access with Tailscale Funnel

Step-by-step setup for getting the board onto phones, from anywhere, over real
HTTPS — the thing notifications and Add-to-Home-Screen require.

**Why this exists:** browsers only allow push notifications and PWA installs on
a address with a certificate they already trust. Tailscale Funnel provides one,
free, with no port forwarding and no domain to buy. When the internet is down,
the shop falls back to the plain-HTTP network address (see the end).

> Setting up a board for someone else's business? Use **their** Tailscale
> account, not yours — the board must not depend on you staying subscribed to
> anything. It takes five minutes for them to make one.

---

## What you need

- The Mac the board runs on
- 10 minutes
- A free Tailscale account (Google, Apple, Microsoft, or email sign-in)

`bootstrap.sh` does all of this automatically and asks before each step — this
guide is the manual path, and the reference for what the script is doing.

---

## Step 1 — Install Tailscale

Download from <https://tailscale.com/download/mac> and drag to Applications,
or:

```bash
brew install --cask tailscale
```

Open the Tailscale app and sign in. On first sign-in macOS asks for a system
password — approve it. The menu-bar icon appears.

**Check it worked:** the menu-bar icon shows connected, or:

```bash
tailscale status
```

prints a line starting with your machine's name.

## Step 2 — Turn on HTTPS certificates

In a browser: open <https://login.tailscale.com/admin/dns>, scroll to
**HTTPS Certificates**, click **Enable**.

This is what lets Tailscale issue a real certificate (Let's Encrypt) for your
board's address. Nothing else in the admin console needs changing for a basic
setup.

## Step 3 — Publish the board

On the Mac that runs the board:

```bash
sudo tailscale funnel --bg 4744
```

(The password prompt is macOS asking permission to change Tailscale's config.)

**Check it worked:**

```bash
tailscale funnel status
```

prints something like:

```
https://your-mac-name.tail1234.ts.net (Funnel on)
|-- / proxy http://127.0.0.1:4744
```

Open that https address in any browser — you should see the board's sign-in
screen. The first certificate can take up to a minute to issue; if the browser
says the site can't be reached, wait a minute and reload.

## Step 4 — Tell the board its addresses

Edit `.env.local` in the board folder:

```bash
TASQ_PUBLIC_URL=https://your-mac-name.tail1234.ts.net
TASQ_ALLOWED_ORIGINS=your-mac-name.tail1234.ts.net,192.168.1.50:4744
```

- `TASQ_PUBLIC_URL` is what Settings QR-codes so people can install the app.
- `TASQ_ALLOWED_ORIGINS` lists both ways in: the funnel hostname (no `https://`)
  and the shop's network address with its port.
- Find the network address with `ipconfig getifaddr en0`.

Restart the board after editing (`start.command`, or restart the service).
Wrong values here do not break sign-in — they break *actions* (creating tasks
and so on) with an "invalid origin" error, so test by tapping something after
signing in.

## Step 5 — Phones

On each phone, open the **https** address (not the http one), tap your name,
set a PIN, then:

- **iPhone:** Share → Add to Home Screen → open from the icon → accept the
  notification prompt.
- **Android:** open in Chrome → menu → Install app → accept notifications.

Notifications are asked-for *after* sign-in on purpose. If a phone says
notifications aren't available, it is almost certainly on the http network
address instead of the https one — Settings → Notifications says which.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `tailscale status` says stopped | Tailscale quit or the Mac rebooted oddly. Open the app, or run `tailscale up`. |
| Funnel refuses to start | In the admin console either HTTPS Certificates is off (Step 2) or your policy blocks funnels — see below. |
| Address worked, now unreachable | Tailscale is signed out, or the Mac slept. Check `tailscale status`; keep the Mac awake (bootstrap offers this). |
| Board loads but taps fail with origin errors | `TASQ_ALLOWED_ORIGINS` is missing the address you are using. Fix and restart (Step 4). |
| Signed-in on phone but asks again on shop Wi-Fi | Normal — cookies are per-address. The https address and the http address are two sessions. Use the https one day to day. |
| Internet is down | Use the network address (`http://<shop-ip>:4744`). Board works; notifications will not fire until phones are back on https. |

Funnel blocked by policy looks like `funnel requires further configuration` or
an ACL error. Fix in the admin console → Access Controls — add this at the top
level of the policy:

```jsonc
"nodeAttrs": [
  { "target": ["autogroup:member"], "attr": ["funnel"] }
]
```

## Living with it

- The funnel survives reboots (`--bg` registers it with the Tailscale daemon).
  Re-check once after the first reboot to be sure.
- The public address reaches the sign-in screen only; every action still needs
  a person's PIN. Anyone you have not added to the board cannot get past it.
- Removing public access later: `sudo tailscale funnel --bg off`. The shop
  network address keeps working.
