/**
 * The bounty ledger: who is owed, who is not, and that only an admin can put
 * money on a task in the first place.
 *   npm run verify:payouts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tasq-payouts-'));
process.env.TASQ_DB_PATH = path.join(tmp, 'verify.db');
process.env.SESSION_SECRET ??= 'x'.repeat(48);

const { initDatabase } = await import('../lib/db/migrate');
const { seedTestUsers } = await import('./helpers/test-users.mts');
const { db } = await import('../lib/db');
const { users, tasks } = await import('../lib/db/schema');
const machine = await import('../lib/task-machine');
const payouts = await import('../lib/payouts');
const recurrences = await import('../lib/recurrences');
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

function post(title: string, rewardCents: number | null, assignedTo: number | null) {
  const r = machine.createTask(chris, {
    title,
    notes: '',
    assignedTo,
    isAsap: false,
    dueLocal: null,
    rewardCents,
  });
  if (!r.ok || r.taskId === undefined) throw new Error(`createTask failed for ${title}`);
  return r.taskId;
}

section('Only an admin can attach money');
const crewTask = machine.createTask(tony, {
  title: 'Crew bounty attempt',
  notes: '',
  assignedTo: null,
  isAsap: false,
  dueLocal: null,
  rewardCents: 5000,
});
check('a non-admin may still post the task', crewTask.ok);
check(
  'but it carries no bounty',
  crewTask.ok &&
    crewTask.taskId !== undefined &&
    db.select().from(tasks).where(eq(tasks.id, crewTask.taskId)).get()!.rewardCents === null,
);

const crewRule = recurrences.createRecurrence(tony, {
  title: 'Crew repeating bounty attempt',
  notes: '',
  defaultAssignee: null,
  isAsap: false,
  pattern: 'weekly',
  weekdays: [1],
  dayOfMonth: null,
  spawnTime: '06:00',
  rewardCents: 5000,
});
check('a non-admin may make a repeating rule', crewRule.ok);
check(
  'and that rule carries no bounty either',
  crewRule.ok && recurrences.listRecurrences().every((r) => r.rewardCents === null),
);

section('Owed is derived from finished work');
check('nobody is owed anything on a fresh board', payouts.outstandingPayouts().length === 0);

const paidJob = post('Load the trailer', 2500, tony.id);
machine.acceptTask(tony, paidJob);
check('an unfinished bounty is not owed yet', payouts.outstandingPayouts().length === 0);

machine.completeTask(tony, paidJob);
const owed1 = payouts.outstandingPayouts();
check('finishing it puts the person on the list', owed1.length === 1 && owed1[0].userId === tony.id);
check('for the right amount', owed1[0]?.cents === 2500, `got ${owed1[0]?.cents}`);
check('and names the job behind it', owed1[0]?.tasks[0]?.title === 'Load the trailer');

const freeJob = post('Sweep up', null, shelly.id);
machine.acceptTask(shelly, freeJob);
machine.completeTask(shelly, freeJob);
check(
  'someone who finished unpaid work never appears',
  payouts.outstandingPayouts().every((p) => p.userId !== shelly.id),
);

const second = post('Wash the loaner', 1500, tony.id);
machine.acceptTask(tony, second);
machine.completeTask(tony, second);
check('two jobs add up on one row', payouts.outstandingPayouts()[0].cents === 4000);
check('and stay one row', payouts.outstandingPayouts().length === 1);
check('the total matches the rows', payouts.totalOwedCents() === 4000);

section('Whoever does the work is owed, not whoever it was assigned to');
const handedOff = post('Grease the hoist', 3000, shelly.id);
machine.completeTask(tony, handedOff);
const owedNow = payouts.outstandingPayouts();
check('the finisher is owed', owedNow.find((p) => p.userId === tony.id)?.cents === 7000);
check('the assignee is not', !owedNow.some((p) => p.userId === shelly.id));

section('Settling');
const settled = payouts.markPersonPaid(chris, tony.id);
check('paying clears the whole balance in one go', settled.ok && settled.cents === 7000);
check('they leave the list entirely', payouts.outstandingPayouts().length === 0);
check('paying again finds nothing', !payouts.markPersonPaid(chris, tony.id).ok);

const later = post('Change the oil', 4000, tony.id);
machine.completeTask(tony, later);
check('new work after a payout starts a fresh balance', payouts.outstandingPayouts()[0].cents === 4000);
check(
  'and the already-settled jobs stay settled',
  payouts.unpaidTasksFor(tony.id).every((t) => t.title === 'Change the oil'),
);

check('one job can be settled on its own', payouts.markTaskPaid(chris, later).ok);
check('settling it twice is refused', !payouts.markTaskPaid(chris, later).ok);
check('and the board is square again', payouts.outstandingPayouts().length === 0);

section('Money reads as money');
check('whole dollars stay whole', payouts.formatCents(2500) === '$25');
check('cents survive', payouts.formatCents(2550) === '$25.50');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
