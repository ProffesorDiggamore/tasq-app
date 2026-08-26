/**
 * Exercises the authentication rules against a throwaway database.
 *   npx tsx scripts/verify-auth.ts
 * Nothing here touches data/tasq.db — TASQ_DB_PATH points somewhere temporary.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tasq-verify-'));
process.env.TASQ_DB_PATH = path.join(tmp, 'verify.db');
process.env.SESSION_SECRET ??= 'x'.repeat(48);

const { db } = await import('../lib/db');
const { users, activityLog, loginThrottle } = await import('../lib/db/schema');
const { hashPin, verifyPin, isValidPinFormat } = await import('../lib/auth/pin');
const throttle = await import('../lib/auth/throttle');
const time = await import('../lib/time');
const { eq } = await import('drizzle-orm');

let failures = 0;
function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(name: string): void {
  console.log(`\n${name}`);
}

const { initDatabase } = await import('../lib/db/migrate');
const { redeemSetupCode, verifySetupCode } = await import('../lib/setup');
const { getSetting } = await import('../lib/settings');
const { seedTestUsers } = await import('./helpers/test-users.mts');

/** The code file lands next to whatever database this run created. */
function readSetupCodeFile(): string {
  return fs.readFileSync(path.join(path.dirname(process.env.TASQ_DB_PATH!), 'setup-code.txt'), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('Code:'))!
    .slice(5)
    .trim();
}

initDatabase();

section('First boot');
const freshBoot = db.select().from(users).all();
check('a fresh install has zero people', freshBoot.length === 0, `got ${freshBoot.length}`);
const code = readSetupCodeFile();
check('a setup code was minted', verifySetupCode(code));

section('Setup redemption');
check(
  'wrong code refused',
  !(await redeemSetupCode('AAAA-BBBB', 'Shop', 'Chris', '1234', '1234')).ok,
);
check(
  'mismatched PIN refused',
  !(await redeemSetupCode(code, 'Shop', 'Chris', '1234', '9999')).ok,
);
check(
  'short name refused',
  !(await redeemSetupCode(code, 'Shop', 'C', '1234', '1234')).ok,
);
check('code still unclaimed after refusals', verifySetupCode(code));
// Lowercase and missing dash both normalise to the same code.
const redeemed = await redeemSetupCode(
  code.toLowerCase().replace('-', ''),
  'Idaho Supply Co',
  'Chris',
  '2481',
  '2481',
);
check('code redeems into the first admin', redeemed.ok);
const chrisRow = db.select().from(users).where(eq(users.name, 'Chris')).get();
check('exactly one person now', db.select({ id: users.id }).from(users).all().length === 1);
check('they are an admin', chrisRow?.isAdmin === true);
check('their PIN is hashed', (chrisRow?.pinHash ?? '').startsWith('scrypt$'));
check('business name stored', getSetting('org.name') === 'Idaho Supply Co');
check('code consumed', !verifySetupCode(code));
check(
  'code file deleted itself after redemption',
  !fs.existsSync(path.join(path.dirname(process.env.TASQ_DB_PATH!), 'setup-code.txt')),
);
const staleInitial = await redeemSetupCode(code, 'Other Shop', 'Nina', '1111', '1111');
check('second redemption refused', !staleInitial.ok && staleInitial.reason === 'already-set-up');
check(
  'refused redemption added nobody',
  db.select({ id: users.id }).from(users).all().length === 1,
);

initDatabase();
const afterSecondBoot = db.select().from(users).all();
check('re-running boot mints nobody and nothing new', afterSecondBoot.length === 1);

seedTestUsers();

section('Test crew');
const seeded = db.select().from(users).orderBy(users.id).all();
check('five people on the crew', seeded.length === 5, `got ${seeded.length}`);
check(
  'Landon, Tony, Shelly and Alyssa joined Chris',
  ['Landon', 'Tony', 'Shelly', 'Alyssa'].every((n) => seeded.some((u) => u.name === n)),
);
check(
  'nobody else has a PIN yet',
  seeded.filter((u) => u.name !== 'Chris').every((u) => u.pinHash === null),
);

section('PIN format');
check('4 digits accepted', isValidPinFormat('0042'));
check('3 digits rejected', !isValidPinFormat('042'));
check('5 digits rejected', !isValidPinFormat('00420'));
check('letters rejected', !isValidPinFormat('12a4'));
check('empty rejected', !isValidPinFormat(''));

section('PIN hashing');
const started = Date.now();
const hash = await hashPin('2481');
const hashMs = Date.now() - started;
check('hash is not the PIN', !hash.includes('2481'));
check('hash records its parameters', hash.startsWith('scrypt$65536$8$1$'));
check('correct PIN verifies', await verifyPin('2481', hash));
check('wrong PIN rejected', !(await verifyPin('2482', hash)));
check(
  `hashing is slow enough to matter (${hashMs}ms)`,
  hashMs >= 50,
  `${hashMs}ms — too fast to resist a 10,000-guess sweep`,
);
const second = await hashPin('2481');
check('same PIN salts differently', second !== hash);

section('Login throttle');
const tony = seeded.find((u) => u.name === 'Tony')!;
const fresh = throttle.throttleState(tony.id);
check('starts unlocked with 5 tries', !fresh.locked && fresh.attemptsRemaining === 5);

let state = throttle.throttleState(tony.id);
for (let i = 1; i <= 4; i += 1) {
  state = throttle.recordFailure(tony.id);
  check(`failure ${i} leaves ${5 - i} tries, still unlocked`, !state.locked && state.attemptsRemaining === 5 - i);
}
state = throttle.recordFailure(tony.id);
check('fifth failure locks out', state.locked);
check(
  'first lockout is about 60 seconds',
  state.retryAfterMs > 55_000 && state.retryAfterMs <= 60_000,
  `${state.retryAfterMs}ms`,
);

// Serve the lockout, then burn five more to prove the doubling.
const past = Date.now() + 61_000;
for (let i = 0; i < 5; i += 1) state = throttle.recordFailure(tony.id, past);
check(
  'second lockout doubles to about 120 seconds',
  state.retryAfterMs > 115_000 && state.retryAfterMs <= 120_000,
  `${state.retryAfterMs}ms`,
);

const later = past + 121_000;
let third = throttle.throttleState(tony.id, later);
check('lockout expires on its own', !third.locked);
for (let i = 0; i < 5; i += 1) third = throttle.recordFailure(tony.id, later);
check(
  'third lockout doubles again to about 240 seconds',
  third.retryAfterMs > 235_000 && third.retryAfterMs <= 240_000,
  `${third.retryAfterMs}ms`,
);

throttle.recordSuccess(tony.id);
const cleared = throttle.throttleState(tony.id);
check('a correct PIN clears the counter and the doubling', !cleared.locked && cleared.attemptsRemaining === 5);
const throttleRow = db.select().from(loginThrottle).where(eq(loginThrottle.userId, tony.id)).get();
check('lockout level reset to zero', throttleRow?.lockoutLevel === 0);

check('60s formats as seconds', throttle.formatLockout(60_000) === '60 seconds');
check('120s formats as minutes', throttle.formatLockout(120_000) === '2 minutes');

section('Activity log is append-only');
const { logActivity } = await import('../lib/activity');
logActivity({
  actorId: tony.id,
  verb: 'auth.failed',
  subjectType: 'user',
  subjectId: tony.id,
  summary: 'Failed PIN for Tony (2 tries left)',
});
const entries = db.select().from(activityLog).all();
// The setup redemption above already wrote one entry; this is the second.
check('entry written', entries.some((e) => e.summary === 'Failed PIN for Tony (2 tries left)'));
check(
  'summary is readable prose',
  entries.find((e) => e.verb === 'auth.failed')?.summary === 'Failed PIN for Tony (2 tries left)',
);
check('summary carries the name, not just an id', entries[entries.length - 1].summary.includes('Tony'));

section('Shop time (America/Boise)');
// 2026-08-17 15:30 UTC is 09:30 in Boise (MDT, UTC-6).
const summer = Date.UTC(2026, 7, 17, 15, 30);
check('local date in summer', time.localDateString(summer) === '2026-08-17', time.localDateString(summer));
check('local clock in summer', time.localClockString(summer) === '09:30', time.localClockString(summer));
// 2026-01-17 15:30 UTC is 08:30 in Boise (MST, UTC-7).
const winter = Date.UTC(2026, 0, 17, 15, 30);
check('local clock in winter', time.localClockString(winter) === '08:30', time.localClockString(winter));
// A UTC instant that is still "yesterday" in Boise must not roll the date over.
const lateNight = Date.UTC(2026, 7, 18, 5, 0); // 23:00 on the 17th, Boise
check('late-night UTC stays on the local date', time.localDateString(lateNight) === '2026-08-17', time.localDateString(lateNight));

check('weekday is Monday', time.localWeekday(summer) === 1, String(time.localWeekday(summer)));
check('day of month', time.localDayOfMonth(summer) === 17);

const sixAm = time.localWallClockToUtc('2026-08-17', '06:00');
check('6am local round-trips', time.localClockString(sixAm) === '06:00', time.localClockString(sixAm));
const sixAmWinter = time.localWallClockToUtc('2026-01-17', '06:00');
check('6am local round-trips across DST', time.localClockString(sixAmWinter) === '06:00', time.localClockString(sixAmWinter));

const middayReset = time.lastBoardResetAt(summer);
check('board reset is 3am local', time.localClockString(middayReset) === '03:00', time.localClockString(middayReset));
check('board reset is today when it is past 3am', time.localDateString(middayReset) === '2026-08-17');
const preDawn = Date.UTC(2026, 7, 17, 8, 0); // 02:00 Boise, before the reset
const preDawnReset = time.lastBoardResetAt(preDawn);
check(
  'before 3am the last reset is yesterday',
  time.localDateString(preDawnReset) === '2026-08-16',
  time.localDateString(preDawnReset),
);

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
