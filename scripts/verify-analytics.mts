/**
 * The Analytics screen: that the figures are right, and — the part that
 * matters — that a crew member's payload simply does not contain the shop's
 * money, anybody else's earnings, or a name-by-name ranking.
 *   npm run verify:analytics
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tasq-analytics-'));
process.env.TASQ_DB_PATH = path.join(tmp, 'verify.db');
process.env.SESSION_SECRET ??= 'x'.repeat(48);

const { initDatabase } = await import('../lib/db/migrate');
const { seedTestUsers } = await import('./helpers/test-users.mts');
const { db } = await import('../lib/db');
const { users, tasks } = await import('../lib/db/schema');
const machine = await import('../lib/task-machine');
const groupsLib = await import('../lib/groups');
const payouts = await import('../lib/payouts');
const { analyticsFor, dayKeys } = await import('../lib/analytics');
const { eq } = await import('drizzle-orm');

let failures = 0;
function check(label: string, condition: boolean, detail = ''): void {
  if (condition) console.log(`  ok    ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}
function section(name: string): void {
  console.log(`\n${name}`);
}

initDatabase();
seedTestUsers();

const all = db.select().from(users).all();
const chris = all.find((u) => u.name === 'Chris')!; // admin
const tony = all.find((u) => u.name === 'Tony')!; // crew
const shelly = all.find((u) => u.name === 'Shelly')!; // crew

const DAY = 86_400_000;
const now = Date.now();

/** Post a task and immediately finish it, at a chosen moment in the past. */
function finish(
  by: typeof tony,
  title: string,
  at: number,
  opts: { rewardCents?: number | null; isAsap?: boolean; groupId?: number | null } = {},
): number {
  const created = machine.createTask(
    chris,
    {
      title,
      notes: '',
      assignedTo: by.id,
      groupId: opts.groupId ?? null,
      isAsap: opts.isAsap ?? false,
      dueLocal: null,
      rewardCents: opts.rewardCents ?? null,
    },
    at,
  );
  if (!created.ok || created.taskId === undefined) {
    throw new Error(`createTask failed for ${title}: ${'message' in created ? created.message : ''}`);
  }
  const done = machine.completeTask(by, created.taskId, at);
  if (!done.ok) throw new Error(`completeTask failed for ${title}`);
  return created.taskId;
}

section('Day buckets');
const keys = dayKeys(now, 90);
check('ninety days come back', keys.length === 90);
check('oldest first, newest last', keys[0] < keys[89]);
check('every day is distinct', new Set(keys).size === 90, `${new Set(keys).size} unique`);

section('A person counts their own work, and only their own');
// Tony: one today, one yesterday, one the day before — a three-day run.
finish(tony, 'Tony today', now);
finish(tony, 'Tony yesterday', now - DAY);
finish(tony, 'Tony two days ago', now - 2 * DAY);
// A gap, then one more, so the run stops at three rather than four.
finish(tony, 'Tony four days ago', now - 4 * DAY);
// Shelly's work must never land in Tony's numbers.
finish(shelly, 'Shelly today', now);
finish(shelly, 'Shelly today two', now);

const tonyView = analyticsFor(tony, now);
const shellyView = analyticsFor(shelly, now);

check('Tony sees his four, not Shelly\'s two', tonyView.personal.done.d7 === 4, `${tonyView.personal.done.d7}`);
check('Shelly sees her two', shellyView.personal.done.d7 === 2, `${shellyView.personal.done.d7}`);
check('a run of three days is a streak of three', tonyView.personal.streakDays === 3, `${tonyView.personal.streakDays}`);
check('the gap ends the run rather than extending it', tonyView.personal.streakDays !== 4);
check('best day is a day, not a total', tonyView.personal.bestDay?.count === 1, `${tonyView.personal.bestDay?.count}`);
check('lifetime total counts everything', tonyView.personal.done.all === 4, `${tonyView.personal.done.all}`);

section('The shop total is everyone, and a share is a fraction of it');
check('the shop shows all six', tonyView.shop.done.d7 === 6, `${tonyView.shop.done.d7}`);
check(
  'Tony\'s share of the month is his four of six',
  tonyView.personal.sharePct === Math.round((4 / 6) * 100),
  `${tonyView.personal.sharePct}%`,
);
check('two people were on the tools', tonyView.shop.activePeople === 2, `${tonyView.shop.activePeople}`);

section('Money is the owner\'s, except your own');
const paidTask = finish(tony, 'Bounty for Tony', now, { rewardCents: 2500 });
finish(shelly, 'Bounty for Shelly', now, { rewardCents: 4000 });
payouts.markTaskPaid(chris, paidTask, now);

const tonyMoney = analyticsFor(tony, now);
check('Tony sees the $25 he was paid', tonyMoney.personal.paidCents === 2500, `${tonyMoney.personal.paidCents}`);
check('and nothing still owed to him', tonyMoney.personal.owedCents === 0, `${tonyMoney.personal.owedCents}`);
check(
  'Shelly sees the $40 she is still owed',
  analyticsFor(shelly, now).personal.owedCents === 4000,
);
check('a crew member gets no admin block at all', tonyMoney.admin === undefined);
check(
  'and the payload carries nobody else\'s money',
  !JSON.stringify(tonyMoney).includes('4000'),
  'Shelly\'s outstanding bounty appeared in Tony\'s payload',
);
check(
  'nor anybody else\'s name',
  !JSON.stringify(tonyMoney).includes('Shelly'),
  'a crew payload named another person',
);

const chrisView = analyticsFor(chris, now);
check('the owner does get one', chrisView.admin !== undefined);
check('with the whole crew on it', (chrisView.admin?.crew.length ?? 0) === all.length, `${chrisView.admin?.crew.length}`);
check('paid out is what was settled', chrisView.admin?.paidOutCents === 2500, `${chrisView.admin?.paidOutCents}`);
check('outstanding is what was not', chrisView.admin?.outstandingCents === 4000, `${chrisView.admin?.outstandingCents}`);
check('owed to one person', chrisView.admin?.owedPeople === 1, `${chrisView.admin?.owedPeople}`);
check(
  'the ranking agrees with the crew payloads',
  chrisView.admin?.crew.find((c) => c.userId === tony.id)?.done30 === tonyMoney.personal.done.d30,
);
check(
  'and it keeps the people who did nothing',
  chrisView.admin?.crew.some((c) => c.done30 === 0) === true,
);

section('A tab you are not on is not in your totals');
const tabResult = groupsLib.createGroup(chris, 'Back office', now);
if (!tabResult.ok || tabResult.groupId === undefined) throw new Error('createGroup failed');
const tabId = tabResult.groupId;
groupsLib.setGroupMembers(chris, tabId, [shelly.id], now);
finish(shelly, 'Back office job', now, { groupId: tabId });

const tonyAfterTab = analyticsFor(tony, now);
const shellyAfterTab = analyticsFor(shelly, now);
const chrisAfterTab = analyticsFor(chris, now);
check(
  'Tony\'s shop total ignores the tab he is not on',
  tonyAfterTab.shop.done.d7 === tonyView.shop.done.d7 + 2,
  `${tonyAfterTab.shop.done.d7}`,
);
check('Shelly, who is on it, counts it', shellyAfterTab.shop.done.d7 === tonyAfterTab.shop.done.d7 + 1);
check('the owner sees every tab', chrisAfterTab.shop.done.d7 === shellyAfterTab.shop.done.d7);

section('Nothing at all is a shape the screen can render');
const alyssa = all.find((u) => u.name === 'Alyssa')!;
const empty = analyticsFor(alyssa, now);
check('an empty series is still dense', empty.personal.series.length === 90);
check('a streak of nothing is zero, not null', empty.personal.streakDays === 0);
check('no best day rather than a fake one', empty.personal.bestDay === null);
check('on-time is null when nothing had a due time', empty.personal.onTimePct === null);
check('all-time is zero', empty.personal.done.all === 0);

section('ASAP and pool claims are counted separately');
finish(tony, 'Urgent one', now, { isAsap: true });
const pool = machine.createTask(
  chris,
  { title: 'Up for grabs', notes: '', assignedTo: null, isAsap: false, dueLocal: null, rewardCents: null },
  now,
);
machine.claimTask(tony, pool.taskId!, now);
machine.completeTask(tony, pool.taskId!, now);
const tonyFinal = analyticsFor(tony, now);
check('the urgent one is counted as urgent', tonyFinal.personal.asapDone === 1, `${tonyFinal.personal.asapDone}`);
check('the claimed one is counted as grabbed', tonyFinal.personal.claimedFromPool === 1, `${tonyFinal.personal.claimedFromPool}`);

section('The board\'s own running figures');
machine.createTask(
  chris,
  { title: 'Still open', notes: '', assignedTo: tony.id, isAsap: false, dueLocal: null, rewardCents: null },
  now,
);
const chrisRunning = analyticsFor(chris, now);
check('an unfinished task is open', chrisRunning.shop.openNow >= 1, `${chrisRunning.shop.openNow}`);
check(
  'time-to-done is a real duration',
  chrisRunning.admin?.medianCompletionMs !== null && (chrisRunning.admin?.medianCompletionMs ?? -1) >= 0,
);
check(
  'time-to-grab is measured only on grabbed work',
  chrisRunning.admin?.medianPickupMs !== null,
);

console.log(
  failures === 0
    ? '\nAnalytics: all checks passed.'
    : `\nAnalytics: ${failures} check${failures === 1 ? '' : 's'} failed.`,
);
process.exit(failures === 0 ? 0 : 1);
