# Apex Board

A task and communication board for Apex Rental's Nampa and Caldwell shops. Runs
on one Mac, reachable from both shops and from phones off-site, costs nothing to
operate.

- **Stack:** Next.js 16 (App Router) · TypeScript · SQLite via better-sqlite3 ·
  Drizzle ORM · iron-session · Motion · Tailwind CSS v4
- **Port:** 4744
- **Data:** a single file at `data/apex.db` (WAL mode)
- **Time zone:** everything is stored as Unix ms UTC and displayed in
  `America/Boise`

## Running it

```bash
cp .env.example .env.local     # then fill in SESSION_SECRET
npm install
npm run dev                    # http://localhost:4744
```

`SESSION_SECRET` is the only variable required to boot. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server on 4744 |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run verify` | Auth, throttle, and shop-time checks against a throwaway database |
| `npm run db:generate` | Generate a migration from `lib/db/schema.ts` |

## How sign-in works

Five people are seeded on first boot: Chris (admin), Landon, Tony, Shelly,
Alyssa. There is no signup.

1. The first time someone taps their name they set a 4-digit PIN, confirmed
   twice. Every later tap asks for it.
2. PINs are hashed with **scrypt** (N=2^16, r=8, p=1, 64-byte key, per-PIN
   salt), which costs roughly 100 ms per attempt. Four digits is only 10,000
   combinations, so the hash alone is not the defence.
3. Five wrong attempts trigger a 60-second lockout that **doubles** each time
   someone burns through another five (60s → 2m → 4m …, capped at 30 minutes).
   A correct PIN clears the counter and the doubling.
4. Every failed attempt is written to History.
5. The session cookie lasts **90 days** and re-issues itself once it is a week
   old, so a phone on the home screen effectively never asks again.
6. "Switch user" in the corner clears the session instantly — no logout
   ceremony, for the shared shop Mac and the iPads.
7. An admin can reset someone's PIN from Settings, which clears the hash (next
   tap re-enrols) and lifts any lockout.

## Layout

```
app/            routes and server actions
components/     UI, all client components under a route-owned folder
lib/db/         Drizzle schema, connection, migrator + seed
lib/auth/       PIN hashing, login throttle, session
lib/motion.ts   Apple spring presets, momentum projection, rubber-banding
lib/time.ts     America/Boise conversions and the 3am board reset
drizzle/        generated SQL migrations (checked in)
scripts/        verification scripts
data/           apex.db lives here (gitignored)
```

Migrations and the user seed run once per server start from
`instrumentation.ts`, so a reboot needs nobody to log in and click anything.
Both operations are idempotent.

## Notes on the two access paths

The board is served over HTTPS through Tailscale Funnel and over plain HTTP on
the shop LAN when the internet is down. Because of that:

- The session cookie is **not** `Secure` by default, or the LAN fallback would
  never keep anyone signed in. Set `APEX_COOKIE_SECURE=true` if you ever serve
  the board over HTTPS only.
- Cookies are per-host, so signing in on the Funnel hostname and on the LAN IP
  are two separate sessions. That is inherent to using both addresses.
- Set `APEX_ALLOWED_ORIGINS` to the Funnel hostname and the LAN address so
  server actions accept requests from both.

## Design

The interface follows the `apple-ui` contract: springs rather than CSS
transitions for anything touchable, feedback on pointer-down, translucent chrome
that content scrolls under, size-specific tracking, 44px minimum touch targets,
and independent handling of `prefers-reduced-motion`,
`prefers-reduced-transparency`, and `prefers-contrast`. Dark is the default —
this gets read at 6am in a shop bay — and a light system setting flips it.
