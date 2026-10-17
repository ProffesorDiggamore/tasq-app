# Cloudflare Tunnel setup (one-time, for Landon)

This gives a shop's Tasq board a permanent https address, e.g.
`https://joespizza.tasqboards.com`. Phones need https to allow push
notifications — that is the whole point. It's free, there is nothing to
renew except the domain (about $10/year), and customers install nothing.

## Part 1 — you do this ONCE, ever

1. Create a free Cloudflare account: https://dash.cloudflare.com/sign-up
2. Register one domain for all your customers, e.g. `tasqboards.com`
   (Cloudflare Registrar, ~$10/year, auto-renews — this is the only
   recurring thing in the whole system).
3. That's it. Every shop will get a subdomain of this one domain.

## Part 2 — per customer, about 2 minutes

1. Cloudflare dashboard → Zero Trust → Networks → Tunnels → Create a tunnel.
   Name it after the shop, e.g. `joespizza`.
2. In the tunnel's Public Hostname tab, add a hostname:
   - Subdomain: `joespizza`, Domain: `tasqboards.com`
   - Service: `http://localhost:4744`
3. Cloudflare shows an install command with a long `--token eyJ...` value.
   Copy JUST the token string.
4. On the shop's Mac, in the Tasq app folder, add this line to `.env.local`:

   ```
   TASQ_TUNNEL_TOKEN=eyJ....the.long.token...
   ```

5. Double-click `start.command` as usual. On first run with a token it
   downloads cloudflared itself (takes a few seconds, then never again),
   starts the tunnel, and the board is live at
   `https://joespizza.tasqboards.com` — tell the shop to put THAT address
   on everyone's phones. Notifications now work on phones.

## Notes

- Recommended for your per-customer flow: the dashboard token above. It needs
  no sign-in on the customer's Mac — you paste one token and you're done. The
  older interactive path (`bash setup/cloudflared.sh`, Homebrew + launchd) also
  works if you ever want the tunnel owned by the customer's own Cloudflare
  account; the launcher detects it and never runs both at once.
- No token in `.env.local` = no tunnel, board works normally on the shop
  network. Adding or removing the token any time just works.
- Tunnel log lives at `data/tunnel.log` if you ever need to debug.
- Cloudflare free tier is generous; a task board's traffic is nowhere near
  the limits.
- The board is reachable from anywhere (that's how phones get push when
  off-site) — login PINs are the protection, so make sure the shop sets
  real ones during setup.
