/**
 * The scheduler's whole job is to be idempotent. These checks hammer it.
 *   npm run verify:scheduler
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-sched-'));
process.env.APEX_DB_PATH = path.join(tmp, 'verify.db');
process.env.SESSION_SECRET ??= 'x'.repeat(48);

const { migrateAndSeed } = await import('../lib/db/migrate');
const { db } = await import('../lib/db');
const { users, tasks, recurrences } = await import('../lib/db/schema');
const rec = await import('../lib/recurrences');
const { localWallClockToUtc } = await import('../lib/time');
const { eq } = await import('drizzle-orm');

let failures = 0;
const check = (label: string, cond: boolean, detail = ''): void => {
  if (cond) console.log(`  ok    ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};
const section = (n: string) => console.log(`\n${n}`);

migrateAndSeed();
const all = db.select().from(users).all();
const chris = all.find((u) => u.name === 'Chris')!;
const tony = all.find((u) => u.name === 'Tony')!;

const base = {
  title: 'Grease everything',
  notes: '',
  defaultAssignee: tony.id,
  isAsap: false,
  pattern: 'weekly' as const,
  weekdays: [1],
  dayOfMonth: null,
  spawnTime: '07:00',
};

// 2026-05-04 is a Monday.
const monday7am = localWallClockToUtc('2026-05-04', '07:00');
const monday6am = localWallClockToUtc('2026-05-04', '06:00');
const monday9am = localWallClockToUtc('2026-05-04', '09:00');
const tuesday9am = localWallClockToUtc('2026-05-05', '09:00');
const nextMonday = localWallClockToUtc('2026-05-11', '09:00');

const created = rec.createRecurrence(chris, base, monday6am);
check('rule created', created.ok);
const ruleId = created.recurrenceId!;

const countFor = (id: number) =>
  db.select().from(tasks).where(eq(tasks.recurrenceId, id)).all().length;

section('Spawning');
check('nothing spawns before the spawn time', rec.spawnDueRecurrences(monday6am).spawned === 0);
check('no task yet', countFor(ruleId) === 0);
check('it spawns once the time arrives', rec.spawnDueRecurrences(monday7am).spawned === 1);
check('exactly one instance', countFor(ruleId) === 1);

section('Idempotency');
check('a second tick in the same minute spawns nothing', rec.spawnDueRecurrences(monday7am).spawned === 0);
check('so does a tick two hours later', rec.spawnDueRecurrences(monday9am).spawned === 0);
let extra = 0;
for (let i = 0; i < 60; i += 1) extra += rec.spawnDueRecurrences(monday9am + i * 60_000).spawned;
check('sixty ticks across the day spawn nothing more', extra === 0, `${extra} extra`);
check('still exactly one instance', countFor(ruleId) === 1, String(countFor(ruleId)));

section('Catch-up after the machine was asleep');
// The Mac was off at 07:00 and boots at 09:00 — the instance is still owed.
const late = rec.createRecurrence(chris, { ...base, title: 'Check the yard lights' }, monday6am);
const lateId = late.recurrenceId!;
check('a rule missed at its spawn time fires on the next tick', rec.spawnDueRecurrences(monday9am).spawned === 1);
check('and only once', rec.spawnDueRecurrences(monday9am).spawned === 0);
check('one instance for the missed rule', countFor(lateId) === 1);

section('Missed days are not backfilled');
// Nothing runs for a week; the machine comes back the following Monday.
const before = countFor(ruleId);
const nextWeek = rec.spawnDueRecurrences(nextMonday);
check('the new Monday spawns one, not one per missed week', nextWeek.spawned === 2, `${nextWeek.spawned}`);
check('the rule gained exactly one instance', countFor(ruleId) === before + 1);

section('Patterns');
check('weekly does not fire on the wrong weekday', rec.spawnDueRecurrences(tuesday9am).spawned === 0);

const daily = rec.createRecurrence(
  chris,
  { ...base, title: 'Sweep the bays', pattern: 'daily', weekdays: [] },
  tuesday9am - 60_000,
);
check('daily fires on a Tuesday', rec.spawnDueRecurrences(tuesday9am).spawned === 1);
check('daily fires again the next day', rec.spawnDueRecurrences(nextMonday).spawned >= 1);

const monthly = rec.createRecurrence(
  chris,
  { ...base, title: 'Rent', pattern: 'monthly', weekdays: [], dayOfMonth: 31, spawnTime: '09:00' },
  localWallClockToUtc('2026-01-01', '00:01'),
);
const monthlyId = monthly.recurrenceId!;
// Other rules are live by now, so these assert on *which* rule fired rather
// than on the global count.
const firedRent = (dateStr: string) =>
  rec.spawnDueRecurrences(localWallClockToUtc(dateStr, '10:00')).titles.includes('Rent');

check('monthly does not fire mid-month', !firedRent('2026-04-15'));
check('the 31st clamps to the 30th in a 30-day month', firedRent('2026-04-30'));
check('and fires on the real 31st in a 31-day month', firedRent('2026-05-31'));
check('February clamps to the 28th', firedRent('2026-02-28'));
check('monthly produced one instance per month, not more', countFor(monthlyId) === 3, String(countFor(monthlyId)));

section('Spawned instances');
const instance = db.select().from(tasks).where(eq(tasks.recurrenceId, ruleId)).all()[0];
check('assigned to the rule owner', instance.assignedTo === tony.id);
check('starts pending', instance.status === 'pending');
check('carries the recurrence id', instance.recurrenceId === ruleId);

section('Pausing');
rec.setRecurrenceActive(chris, ruleId, false);
const afterPause = rec.spawnDueRecurrences(localWallClockToUtc('2026-06-01', '10:00')).titles;
check('a paused rule stops spawning', !afterPause.includes('Grease everything'), afterPause.join(','));
rec.setRecurrenceActive(chris, ruleId, true);
check(
  'resuming brings it back on its next due day',
  rec.spawnDueRecurrences(localWallClockToUtc('2026-06-08', '10:00')).titles.includes('Grease everything'),
);

section('Archived assignee falls back to the pool');
const archived = rec.createRecurrence(
  chris,
  { ...base, title: 'Fuel check', pattern: 'daily', weekdays: [], defaultAssignee: tony.id },
  localWallClockToUtc('2026-07-01', '00:01'),
);
db.update(users).set({ archivedAt: Date.now() }).where(eq(users.id, tony.id)).run();
rec.spawnDueRecurrences(localWallClockToUtc('2026-07-01', '10:00'));
const orphan = db.select().from(tasks).where(eq(tasks.recurrenceId, archived.recurrenceId!)).all()[0];
check('it spawns into the open pool instead of to nobody', orphan.assignedTo === null);

section('Descriptions read like English');
check('daily', rec.describeSchedule('daily', [], null, '06:00') === 'every day at 6:00am');
check('one weekday', rec.describeSchedule('weekly', [1], null, '07:00') === 'Mondays at 7:00am');
check(
  'several weekdays',
  rec.describeSchedule('weekly', [1, 3, 5], null, '07:30') === 'Mondays, Wednesdays and Fridays at 7:30am',
  rec.describeSchedule('weekly', [1, 3, 5], null, '07:30'),
);
check('monthly', rec.describeSchedule('monthly', [], 1, '09:00') === 'on the 1st of the month at 9:00am');
check('monthly ordinals', rec.describeSchedule('monthly', [], 22, '13:00') === 'on the 22nd of the month at 1:00pm');
check('noon reads as 12', rec.describeSchedule('daily', [], null, '12:00') === 'every day at 12:00pm');
check('midnight reads as 12am', rec.describeSchedule('daily', [], null, '00:00') === 'every day at 12:00am');

section('Validation');
check('a weekly rule needs a day', rec.validateRecurrence({ ...base, weekdays: [] }) !== null);
check('a monthly rule needs a date', rec.validateRecurrence({ ...base, pattern: 'monthly', dayOfMonth: null }) !== null);
check('a bad time is refused', rec.validateRecurrence({ ...base, spawnTime: '25:00' }) !== null);
check('a good rule passes', rec.validateRecurrence(base) === null);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
