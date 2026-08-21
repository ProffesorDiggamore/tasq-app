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

Double-click **`start.command`** in Finder. It installs, builds, starts the
board on port 4744, and opens a browser at it. Leave the window open — the
recurrence scheduler and the overdue nudges only run while the server does.

From a terminal:

```bash
cp .env.example .env.local     # then fill in SESSION_SECRET
npm install
npm run dev                    # http://localhost:4744, with hot reload
```

On the shop Mac the board runs as a launchd service instead, so it survives
reboots with nobody logging in — see `setup/README.md`. That requires the app to
live outside `~/Documents`; macOS blocks background services from reading it.

`SESSION_SECRET` is the only variable required to boot. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server on 4744 |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run verify` | All seven suites below — 286 checks |
| `npm run verify:auth` | PIN hashing, throttle, and shop-time checks |
| `npm run verify:tasks` | The task status machine, claim race, and board rows |
| `npm run verify:scheduler` | Recurrence patterns, idempotency, and catch-up |
| `npm run verify:notify` | Who gets told what, supplies, and History filters |
| `npm run verify:push` | VAPID signing, encryption, and dead-subscription pruning |
| `npm run verify:editing` | Changing your own PIN, editing tasks and repeat rules |
| `npm run verify:setup` | Installer scripts, launchd plists, and `.env.local` editing |
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
8. Anyone can change **their own** PIN from Settings without an admin. That is a
   different operation from a reset: it requires the current PIN first, and it
   is throttled the same way as the login screen — a signed-in session is not a
   licence to brute-force four digits, because a phone left unlocked on a bench
   is exactly the case that protects against.

## The task status machine

Anyone can create a task for anyone, including for themselves and for the open
pool. `lib/task-machine.ts` holds every transition; `app/actions.ts` only
resolves who is asking and revalidates.

- **Assigned on creation** → `pending`. That person **Accepts** (→ `accepted`)
  or **Declines**, which clears the assignee, records the reason, and drops the
  task back to `pending` in the open pool for someone else. Declining never
  kills a task, so `declined` is not a resting state.
- **Unassigned on creation** → `pending` with no assignee, in **Up for Grabs**.
  The first **Claim** wins. Claiming *is* accepting, so it skips `pending`.
- **Anyone can mark anything done.** No proof, no photo — the work is visible in
  the shop, and an undone task stays on the board. `completed_by` records who
  actually did it, separately from who owned it.
- **Cancel** is a soft delete by the creator or an admin. Nothing is ever
  removed from the file.

Every transition is a conditional `UPDATE` guarded on the state it expects to
find. Two people acting in the same second is normal on a shared board, so a
transition that changes no rows works out why and answers with it — the person
who lost a claim sees "Tony just grabbed this", not an error.

The claim race in particular is settled by a single
`UPDATE ... WHERE assigned_to IS NULL AND status = 'pending'`. SQLite serialises
the writes, so exactly one caller reports a changed row.
`npm run verify:tasks` fires ten claims at one task and asserts a single winner.

## Editing

- **Tasks** can be edited by their creator or an admin — the same bar as
  cancelling, since retitling someone's work is the same kind of act. Reassigning
  deliberately drops the task back to `pending`: the new owner has not agreed to
  anything, and inheriting someone else's acceptance would make the board claim
  a person took work they have never seen. Turning ASAP on notifies everyone
  once; later edits do not re-alert.
- **Repeat rules** are editable in Settings — title, details, who it goes to,
  ASAP, pattern, days, and time of day. Copies already on the board keep what
  they say; only the next one changes. Rules can be paused or deleted, and a
  delete is soft, so the tasks it already spawned stay intact.

## The board

Five rows, each a horizontal carousel:

1. **ASAP** — shared by everyone, warmer and wider, sorted by due time. The
   first thing you see starting a shift.
2. **Your tasks** — yours, with anything awaiting an Accept at the front.
3. **Up for grabs** — the open pool, one tap to claim.
4. **Today's recurring** — instances spawned since the board last cleared.
5. **Done today** — collapsed by default, with an undo on every card.

A task legitimately appears in more than one row (an ASAP task assigned to you
is in both ASAP and Your Tasks); the rows are views, not buckets.

Completed tasks age off the board at **3am shop time** — that is a query
boundary, not a deletion, so History keeps them forever. Badge counts on ASAP
and Your Tasks are rendered in-app so they still work for anyone who declines
notifications.

The board polls every 30 seconds while the tab is visible and refreshes the
moment it comes back, so a screen left open in the shop stays current.

## Repeating tasks

A rule (`recurrences`) spawns a fresh task on a schedule: daily, certain
weekdays, or a day of the month. "The 31st" clamps to the last day in shorter
months rather than skipping them.

One in-process scheduler ticks every minute (`lib/scheduler.ts`). The
idempotency guard is a conditional `UPDATE` on `last_spawned_on`: the day is
*claimed* before the task is inserted, and the claim only matches while the
column holds something other than today's local date. Overlapping ticks, a boot
that races the interval, and a machine waking from sleep all funnel through the
same claim, so a rule spawns at most once per local day.

Catch-up is that same path — a rule whose 7am spawn time passed while the Mac
was asleep still has yesterday's date in the column, so the next tick fires it.
Missed *days* are deliberately not backfilled: nobody wants Monday's greasing to
appear four times because the machine was off all week.

`npm run verify:scheduler` runs sixty ticks across a day and asserts exactly one
instance.

## Supply requests

Anyone can ask for something and see their own. Only admins see the queue, which
reads as a shopping list — `item · quantity / requester`, grouped by status with
the oldest outstanding request first. Chris advances each one with a tap, and
status moves one step at a time in either direction, so a mis-tap is undoable
and two admins tapping at once cannot skip a step.

## History

Admin only, append-only, reverse-chronological, grouped by shop-local day.
Filter by person and by date range; "this week" runs Monday to Sunday and is the
default. Summaries are written as finished prose at the moment the event
happens, so History stays readable years later even if a person has been renamed
since — no row ever has to be joined back to decode it.

## Notifications

Web Push over VAPID. No SMS: it costs money per message. Everything leaves
through one function (`lib/notify.ts`), so adding a Twilio adapter later means
writing one more `Channel` there and touching no feature code.

The status machine returns notification *intents* rather than sending anything.
That keeps it synchronous and testable — `npm run verify:notify` asserts on the
exact audience and copy without a push service in the loop, and
`npm run verify:push` proves the transport against a local TLS stand-in,
including that a 410 prunes the subscription and a connection refusal does not.

Sent when: a task is assigned to you, a task you created is declined, an ASAP
task is created (everyone but the author), a task of yours goes overdue (once —
guarded by `overdue_notified_at`), a supply request is created (admins), and
your supply request is ordered or received.

Permission is asked **after** someone is signed in and looking at the board,
with a sentence explaining why — never on first paint, where a permission dialog
has no story attached and gets denied out of reflex. The iOS
Add-to-Home-Screen hint shows at most twice, then stops.

## PWA

Manifest, icons, and a service worker at `public/sw.js`. The worker caches
hashed build assets and serves an offline page for navigations, but deliberately
does **not** cache board data — a stale task list is worse than an honest
"you're offline", because someone would act on work that is already done.

It is registered in production only. Cache-first on `/_next/static/` is right
for hashed production assets and wrong for dev chunks, where it pins old code;
in development the component unregisters any worker and clears its caches
instead.

## Layout

```
app/            routes and server actions
components/     UI, all client components under a route-owned folder
lib/db/         Drizzle schema, connection, migrator + seed
lib/auth/       PIN hashing, login throttle, session
lib/tasks.ts    board row queries
lib/recurrences.ts   repeat rules and the idempotent spawn
lib/scheduler.ts     the one-minute tick
lib/supplies.ts      supply requests and the admin queue
lib/history.ts       the activity log, filtered and grouped
lib/notify.ts        the single seam everything leaves through
lib/task-machine.ts  every task transition, free of request context
lib/motion.ts   Apple spring presets, momentum projection, rubber-banding
lib/use-press.ts     pointer-down feedback with slop and cancel-by-drag
components/ui/  Button, Rail, PressableLink, MotionProvider
setup/          launchd jobs, backups, deploy — see setup/README.md
lib/time.ts     America/Boise conversions and the 3am board reset
drizzle/        generated SQL migrations (checked in)
scripts/        verification scripts
data/           apex.db lives here (gitignored)
```

Migrations and the user seed run once per server start from
`instrumentation.ts`, so a reboot needs nobody to log in and click anything.
Both operations are idempotent.

## Deploying it

On the shop Mac, the whole install is one command:

```bash
bash setup/bootstrap.sh
```

Run it as yourself, not with `sudo` — it asks for your password at the three
steps that need root. It checks the machine, moves the app out of a
TCC-protected folder if that is where it is, generates the secrets, builds,
runs the checks, installs the launchd jobs, offers to stop the Mac sleeping,
offers to turn on Tailscale Funnel, and prints the addresses. Re-running is
safe: it never regenerates keys that already exist and never touches the
database.

```bash
setup/deploy.sh      # update: pull, build, verify, restart
setup/uninstall.sh   # remove the jobs; leaves the database and backups alone
```

`setup/README.md` has the full manual walkthrough behind that, plus
troubleshooting.

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

**Press feedback** is driven by `lib/use-press.ts`, not CSS `:active`. On iOS
`:active` only applies under conditions that are easy to lose, and it cannot
express cancel-by-drag. The hook lights the control on pointer-*down*, keeps a
10px slop around it so a wobbling finger still counts as pressing, lifts the
press if the finger wanders further, re-arms if it comes back, and fires nothing
if the release lands outside. It deliberately does not call
`setPointerCapture` — these buttons sit inside horizontally scrolling
carousels, and capturing the pointer would swallow the swipe.

The one exception is the PIN keypad, where a digit commits on press-down: there
is nothing to cancel on a keypad, and waiting for release makes it feel dead.

**One `Button`** (`components/ui/Button.tsx`) covers every case; the card, the
sheet, the settings list and the task form each used to carry their own
near-identical copy. The press scale lives on an inner span so the hit area does
not shrink away from the finger mid-press.

**Carousels** keep the browser's own scrolling. Native momentum and the
platform's rubber-band at the ends beat anything hand-rolled, and taking the
gesture over would mean fighting non-cancelable `touchmove` on iOS mid-scroll —
trading a good bounce for a hard stop on the device this runs on most.
`overscroll-behavior-x: contain` stops the page scroll-chaining without
suppressing that bounce. What the platform does *not* provide is any sign that
there is more content past an edge, so `components/ui/Rail.tsx` fades the
content out under whichever edge it continues past, and only that edge.

`MotionConfig reducedMotion="user"` wraps the app, so spring and layout
animations respect the OS preference — the stylesheet alone only covers CSS
transitions. The scroll edge under the header appears only once content is
actually beneath it; a permanent gradient is a divider wearing a costume.

The task sheet is dragged, not dismissed: `components/board/useSheetDrag.ts`
tracks the finger 1:1, rubber-bands above the resting position, projects where a
flick is *going* rather than where it stopped, and hands the release velocity to
the settling spring so there is no seam between the drag and the animation. A
sheet caught mid-flight resumes from its live on-screen position.

`app/globals.css` puts its element resets in `@layer base` and its primitives in
`@layer components` on purpose. Unlayered CSS outranks every Tailwind layer, so
an unlayered `button { padding: 0 }` would silently beat `px-4` on every button
in the app.
