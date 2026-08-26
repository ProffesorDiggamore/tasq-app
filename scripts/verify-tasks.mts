/**
 * Exercises the task status machine against a throwaway database, with the
 * concurrency cases the board actually hits.
 *   npm run verify:tasks
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tasq-tasks-'));
process.env.TASQ_DB_PATH = path.join(tmp, 'verify.db');
process.env.SESSION_SECRET ??= 'x'.repeat(48);

const { initDatabase } = await import('../lib/db/migrate');
const { seedTestUsers } = await import('./helpers/test-users.mts');
const { db } = await import('../lib/db');
const { users, tasks, activityLog } = await import('../lib/db/schema');
const machine = await import('../lib/task-machine');
const board = await import('../lib/tasks');
const { localWallClockToUtc } = await import('../lib/time');
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
const chris = all.find((u) => u.name === 'Chris')!;
const landon = all.find((u) => u.name === 'Landon')!;
const tony = all.find((u) => u.name === 'Tony')!;
const shelly = all.find((u) => u.name === 'Shelly')!;
const alyssa = all.find((u) => u.name === 'Alyssa')!;

function row(taskId: number) {
  return db.select().from(tasks).where(eq(tasks.id, taskId)).get()!;
}
function makeTask(
  actor = chris,
  overrides: Partial<Parameters<typeof machine.createTask>[1]> = {},
  now = Date.now(),
): number {
  const result = machine.createTask(
    actor,
    { title: 'Task', notes: '', assignedTo: null, isAsap: false, dueLocal: null, rewardCents: null, ...overrides },
    now,
  );
  if (!result.ok || result.taskId === undefined) throw new Error('createTask failed');
  return result.taskId;
}

section('Creating');
const assigned = makeTask(chris, { title: 'Grease the skid steer', assignedTo: tony.id });
check('starts pending', row(assigned).status === 'pending');
check('assigned to the named person', row(assigned).assignedTo === tony.id);
check('records who created it', row(assigned).createdBy === chris.id);

const pooled = makeTask(chris, { title: 'Sweep the yard' });
check('no assignee means the open pool', row(pooled).assignedTo === null);
check('pool task is pending', row(pooled).status === 'pending');

const noTitle = machine.createTask(chris, {
  title: '   ',
  notes: '',
  assignedTo: null,
  isAsap: false,
  dueLocal: null,
  rewardCents: null,
});
check('a blank title is refused', !noTitle.ok);

const goneUser = machine.createTask(chris, {
  title: 'x',
  notes: '',
  assignedTo: 9999,
  isAsap: false,
  dueLocal: null,
  rewardCents: null,
});
check('assigning to nobody real is refused', !goneUser.ok);

const dueTask = makeTask(chris, { title: 'Rent', dueLocal: '2026-09-01T09:00' });
check(
  'due time is stored as shop wall clock',
  row(dueTask).dueAt === localWallClockToUtc('2026-09-01', '09:00'),
);

section('Accept and decline');
check('Tony can accept his own', machine.acceptTask(tony, assigned).ok);
check('now accepted', row(assigned).status === 'accepted');
check('acceptance is timestamped', row(assigned).acceptedAt !== null);

const notYours = machine.acceptTask(shelly, assigned);
check('someone else cannot accept it', !notYours.ok);
check(
  'and is told who has it',
  !notYours.ok && notYours.reason === 'claimed' && notYours.by === 'Tony',
  JSON.stringify(notYours),
);

check('Tony can decline it', machine.declineTask(tony, assigned, 'On a delivery until 3').ok);
check('declining clears the assignee', row(assigned).assignedTo === null);
check('declining returns it to pending, not declined', row(assigned).status === 'pending');
check('the reason is kept', row(assigned).declineReason === 'On a delivery until 3');
check('it is back in the pool', board.upForGrabs().some((t) => t.id === assigned));

section('The claim race');
const contested = makeTask(chris, { title: 'Load the trailer' });
const firstClaim = machine.claimTask(shelly, contested);
const secondClaim = machine.claimTask(alyssa, contested);
check('the first claim wins', firstClaim.ok);
check('the second claim loses', !secondClaim.ok);
check(
  'the loser is told who got it, not shown an error',
  !secondClaim.ok && secondClaim.reason === 'claimed' && secondClaim.by === 'Shelly',
  JSON.stringify(secondClaim),
);
check('exactly one owner', row(contested).assignedTo === shelly.id);
check('claiming is accepting — it skips pending', row(contested).status === 'accepted');
check('claim and accept are both stamped', row(contested).claimedAt !== null && row(contested).acceptedAt !== null);

// Ten people going for the same task must still produce exactly one winner.
const stampede = makeTask(chris, { title: 'Fuel the truck' });
const claimants = [landon, tony, shelly, alyssa, chris, landon, tony, shelly, alyssa, chris];
const wins = claimants.filter((who) => machine.claimTask(who, stampede).ok).length;
check('ten simultaneous claims produce one winner', wins === 1, `${wins} winners`);

section('Completing and undoing');
check('anyone can finish anything', machine.completeTask(landon, contested).ok);
check('marked done', row(contested).status === 'done');
check('records who actually did it', row(contested).completedBy === landon.id);
check("and keeps the owner's name on it", row(contested).assignedTo === shelly.id);

const twice = machine.completeTask(alyssa, contested);
check('finishing an already-finished task is refused', !twice.ok);
check(
  'and says who beat them to it',
  !twice.ok && twice.reason === 'stale' && twice.message.includes('Landon'),
  !twice.ok && twice.reason === 'stale' ? twice.message : JSON.stringify(twice),
);

check('it can be put back', machine.reopenTask(shelly, contested).ok);
check('an owned task reopens to accepted', row(contested).status === 'accepted');
check('the completion is cleared', row(contested).completedAt === null && row(contested).completedBy === null);

const poolDone = makeTask(chris, { title: 'Hose down the bay' });
machine.completeTask(tony, poolDone);
machine.reopenTask(tony, poolDone);
check('an unowned task reopens to the pool', row(poolDone).status === 'pending' && row(poolDone).assignedTo === null);

section('Cancelling is a soft delete');
const chrisTask = makeTask(chris, { title: "Chris's errand" });
const refused = machine.cancelTask(tony, chrisTask);
check('a bystander cannot cancel it', !refused.ok);
check('creator can cancel it', machine.cancelTask(chris, chrisTask).ok);
check('the row survives', row(chrisTask) !== undefined);
check('status is cancelled', row(chrisTask).status === 'cancelled');
check('it leaves every board row', !board.upForGrabs().some((t) => t.id === chrisTask));

// Creation is admin-only now, so "someone else" is a second admin. The
// machine reads the actor it is handed, so promote the object directly.
const landonAsAdmin = { ...landon, isAdmin: true };
const landonTask = makeTask(landonAsAdmin, { title: "Landon's errand" });
check('an admin can cancel what someone else created', machine.cancelTask(chris, landonTask).ok);
check('a non-admin cannot post tasks', !machine.createTask(tony, {
  title: 'Not allowed',
  notes: '',
  assignedTo: null,
  isAsap: false,
  dueLocal: null,
  rewardCents: null,
}).ok);

const cancelDone = makeTask(chris, { title: 'Already finished' });
machine.completeTask(chris, cancelDone);
check('a finished task cannot be cancelled out from under History', !machine.cancelTask(chris, cancelDone).ok);

section('Board rows');
const asapTask = makeTask(chris, { title: 'Rent is due at 9', isAsap: true, assignedTo: tony.id });
check('ASAP shows for everyone, not just the owner', board.asapTasks().some((t) => t.id === asapTask));
check("and also sits in the owner's row", board.myTasks(tony.id).some((t) => t.id === asapTask));
check("but not in someone else's", !board.myTasks(shelly.id).some((t) => t.id === asapTask));

const tonyBoard = board.loadBoard(tony.id);
check('the badge counts what is waiting on you', tonyBoard.awaitingYou >= 1);
check('the ASAP badge counts open ASAP work', tonyBoard.asapCount === board.asapTasks().length);
check('a done task is out of Your Tasks', !board.myTasks(landon.id).some((t) => t.id === poolDone && t.status === 'done'));

section('Done Today clears at 3am, History does not');
const morning = localWallClockToUtc('2026-05-04', '10:00');
const nextMorning = localWallClockToUtc('2026-05-05', '10:00');
const beforeReset = localWallClockToUtc('2026-05-05', '02:00');
const dayTask = makeTask(chris, { title: 'Monday grease' }, morning);
machine.completeTask(tony, dayTask, morning);

check('it is in Done Today on the day', board.doneToday(morning).some((t) => t.id === dayTask));
check(
  'still there at 2am, before the board clears',
  board.doneToday(beforeReset).some((t) => t.id === dayTask),
);
check(
  'gone from the board after 3am the next day',
  !board.doneToday(nextMorning).some((t) => t.id === dayTask),
);
check('the row itself is untouched', row(dayTask).status === 'done');
const logged = db.select().from(activityLog).all();
check(
  'and History still holds the completion',
  logged.some((e) => e.subjectId === dayTask && e.verb === 'task.completed'),
);

section('History reads as prose');
const summaries = logged.map((e) => e.summary);
check('a claim reads plainly', summaries.some((s) => s === 'Shelly grabbed "Load the trailer"'));
check('a decline carries the reason', summaries.some((s) => s.includes('passed on') && s.includes('On a delivery until 3')));
check(
  'finishing someone else\'s task says whose it was',
  summaries.some((s) => s === 'Landon finished "Load the trailer" (Shelly\'s task)'),
);
check('an ASAP assignment is marked', summaries.some((s) => s.includes('(ASAP)')));
check('no summary leaks a raw id', summaries.every((s) => !/\bid[:=]/i.test(s)));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
