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
const { myDaySections } = await import('../components/board/task-display');
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

await initDatabase();
await seedTestUsers();

const all = await db.select().from(users).all();
const chris = all.find((u) => u.name === 'Chris')!;
const landon = all.find((u) => u.name === 'Landon')!;
const tony = all.find((u) => u.name === 'Tony')!;
const shelly = all.find((u) => u.name === 'Shelly')!;
const alyssa = all.find((u) => u.name === 'Alyssa')!;

async function row(taskId: number) {
  return (await db.select().from(tasks).where(eq(tasks.id, taskId)).get())!;
}
async function makeTask(
  actor = chris,
  overrides: Partial<Parameters<typeof machine.createTask>[1]> = {},
  now = Date.now(),
): Promise<number> {
  const result = await machine.createTask(
    actor,
    { title: 'Task', notes: '', assignedTo: null, isAsap: false, dueLocal: null, rewardCents: null, ...overrides },
    now,
  );
  if (!result.ok || result.taskId === undefined) throw new Error('createTask failed');
  return result.taskId;
}

section('Creating');
const assigned = await makeTask(chris, { title: 'Grease the skid steer', assignedTo: tony.id });
check('starts pending', (await row(assigned)).status === 'pending');
check('assigned to the named person', (await row(assigned)).assignedTo === tony.id);
check('records who created it', (await row(assigned)).createdBy === chris.id);

const pooled = await makeTask(chris, { title: 'Sweep the yard' });
check('no assignee means the open pool', (await row(pooled)).assignedTo === null);
check('pool task is pending', (await row(pooled)).status === 'pending');

const noTitle = await machine.createTask(chris, {
  title: '   ',
  notes: '',
  assignedTo: null,
  isAsap: false,
  dueLocal: null,
  rewardCents: null,
});
check('a blank title is refused', !noTitle.ok);

const goneUser = await machine.createTask(chris, {
  title: 'x',
  notes: '',
  assignedTo: 9999,
  isAsap: false,
  dueLocal: null,
  rewardCents: null,
});
check('assigning to nobody real is refused', !goneUser.ok);

const dueTask = await makeTask(chris, { title: 'Rent', dueLocal: '2026-09-01T09:00' });
check(
  'due time is stored as shop wall clock',
  (await row(dueTask)).dueAt === localWallClockToUtc('2026-09-01', '09:00'),
);

section('Accept and decline');
check('Tony can accept his own', (await machine.acceptTask(tony, assigned)).ok);
check('now accepted', (await row(assigned)).status === 'accepted');
check('acceptance is timestamped', (await row(assigned)).acceptedAt !== null);

const notYours = await machine.acceptTask(shelly, assigned);
check('someone else cannot accept it', !notYours.ok);
check(
  'and is told who has it',
  !notYours.ok && notYours.reason === 'claimed' && notYours.by === 'Tony',
  JSON.stringify(notYours),
);

check('Tony can decline it', (await machine.declineTask(tony, assigned, 'On a delivery until 3')).ok);
check('declining clears the assignee', (await row(assigned)).assignedTo === null);
check('declining returns it to pending, not declined', (await row(assigned)).status === 'pending');
check('the reason is kept', (await row(assigned)).declineReason === 'On a delivery until 3');
check('it is back in the pool', (await board.upForGrabs()).some((t) => t.id === assigned));

section('The claim race');
const contested = await makeTask(chris, { title: 'Load the trailer' });
const firstClaim = await machine.claimTask(shelly, contested);
const secondClaim = await machine.claimTask(alyssa, contested);
check('the first claim wins', firstClaim.ok);
check('the second claim loses', !secondClaim.ok);
check(
  'the loser is told who got it, not shown an error',
  !secondClaim.ok && secondClaim.reason === 'claimed' && secondClaim.by === 'Shelly',
  JSON.stringify(secondClaim),
);
check('exactly one owner', (await row(contested)).assignedTo === shelly.id);
check('claiming is accepting — it skips pending', (await row(contested)).status === 'accepted');
check('claim and accept are both stamped', (await row(contested)).claimedAt !== null && (await row(contested)).acceptedAt !== null);

// Ten people going for the same task must still produce exactly one winner.
const stampede = await makeTask(chris, { title: 'Fuel the truck' });
const claimants = [landon, tony, shelly, alyssa, chris, landon, tony, shelly, alyssa, chris];
// All ten in flight at once — with the database behind a network hop this is a
// real race, not ten calls taking turns.
const outcomes = await Promise.all(claimants.map((who) => machine.claimTask(who, stampede)));
const wins = outcomes.filter((r) => r.ok).length;
check('ten simultaneous claims produce one winner', wins === 1, `${wins} winners`);

section('Completing and undoing');
check('anyone can finish anything', (await machine.completeTask(landon, contested)).ok);
check('marked done', (await row(contested)).status === 'done');
check('records who actually did it', (await row(contested)).completedBy === landon.id);
check("and keeps the owner's name on it", (await row(contested)).assignedTo === shelly.id);

const twice = await machine.completeTask(alyssa, contested);
check('finishing an already-finished task is refused', !twice.ok);
check(
  'and says who beat them to it',
  !twice.ok && twice.reason === 'stale' && twice.message.includes('Landon'),
  !twice.ok && twice.reason === 'stale' ? twice.message : JSON.stringify(twice),
);

check('it can be put back', (await machine.reopenTask(shelly, contested)).ok);
check('an owned task reopens to accepted', (await row(contested)).status === 'accepted');
check('the completion is cleared', (await row(contested)).completedAt === null && (await row(contested)).completedBy === null);

const poolDone = await makeTask(chris, { title: 'Hose down the bay' });
await machine.completeTask(tony, poolDone);
await machine.reopenTask(tony, poolDone);
check('an unowned task reopens to the pool', (await row(poolDone)).status === 'pending' && (await row(poolDone)).assignedTo === null);

section('Cancelling is a soft delete');
const chrisTask = await makeTask(chris, { title: "Chris's errand" });
const refused = await machine.cancelTask(tony, chrisTask);
check('a bystander cannot cancel it', !refused.ok);
check('creator can cancel it', (await machine.cancelTask(chris, chrisTask)).ok);
check('the row survives', await row(chrisTask) !== undefined);
check('status is cancelled', (await row(chrisTask)).status === 'cancelled');
check('it leaves every board row', !(await board.upForGrabs()).some((t) => t.id === chrisTask));

const landonTask = await makeTask(landon, { title: "Landon's errand" });
check('an admin can cancel what someone else created', (await machine.cancelTask(chris, landonTask)).ok);

// Anyone posts work since tabs shipped; what stays admin-only is the money.
const crewPost = await machine.createTask(tony, {
  title: 'Crew can post',
  notes: '',
  assignedTo: null,
  isAsap: false,
  dueLocal: null,
  rewardCents: 5000,
});
check('a non-admin can post a task', crewPost.ok);
check(
  'but the bounty they tried to attach is dropped',
  crewPost.ok && crewPost.taskId !== undefined && (await row(crewPost.taskId)).rewardCents === null,
);

const cancelDone = await makeTask(chris, { title: 'Already finished' });
await machine.completeTask(chris, cancelDone);
check('a finished task cannot be cancelled out from under History', !(await machine.cancelTask(chris, cancelDone)).ok);

section('Board rows');
const asapTask = await makeTask(chris, { title: 'Rent is due at 9', isAsap: true, assignedTo: tony.id });
check('ASAP shows for everyone, not just the owner', (await board.asapTasks()).some((t) => t.id === asapTask));
check("and also sits in the owner's row", (await board.myTasks(tony.id)).some((t) => t.id === asapTask));
check("but not in someone else's", !(await board.myTasks(shelly.id)).some((t) => t.id === asapTask));

const tonyBoard = await board.loadBoard(tony.id);
check('the badge counts what is waiting on you', tonyBoard.awaitingYou >= 1);
check('the ASAP badge counts open ASAP work', tonyBoard.asapCount === (await board.asapTasks()).length);
check('a done task is out of Your Tasks', !(await board.myTasks(landon.id)).some((t) => t.id === poolDone && t.status === 'done'));

const urgentPool = await makeTask(chris, { title: 'Urgent and unclaimed', isAsap: true });
const dayBoard = await board.loadBoard(tony.id);
const day = myDaySections(dayBoard);
const renderedIds = [...day.mine, ...day.urgent, ...day.available, ...day.teamToday].map(
  (task) => task.id,
);
const sourceIds = new Set(
  [...dayBoard.mine, ...dayBoard.asap, ...dayBoard.pool, ...dayBoard.recurring]
    .filter((task) => task.status !== 'done' && task.status !== 'cancelled')
    .map((task) => task.id),
);
check('My Day renders each open task once', new Set(renderedIds).size === renderedIds.length);
check('My Day preserves every open task', renderedIds.length === sourceIds.size);
check('assigned urgent work stays under For you', day.mine.some((task) => task.id === asapTask));
check('assigned urgent work is not duplicated', !day.urgent.some((task) => task.id === asapTask));
check('unclaimed urgent work stays urgent', day.urgent.some((task) => task.id === urgentPool));
check('unclaimed urgent work is not duplicated as available', !day.available.some((task) => task.id === urgentPool));

section('Done Today clears at 3am, History does not');
const morning = localWallClockToUtc('2026-05-04', '10:00');
const nextMorning = localWallClockToUtc('2026-05-05', '10:00');
const beforeReset = localWallClockToUtc('2026-05-05', '02:00');
const dayTask = await makeTask(chris, { title: 'Monday grease' }, morning);
await machine.completeTask(tony, dayTask, morning);

check('it is in Done Today on the day', (await board.doneToday(morning)).some((t) => t.id === dayTask));
check(
  'still there at 2am, before the board clears',
  (await board.doneToday(beforeReset)).some((t) => t.id === dayTask),
);
check(
  'gone from the board after 3am the next day',
  !(await board.doneToday(nextMorning)).some((t) => t.id === dayTask),
);
check('the row itself is untouched', (await row(dayTask)).status === 'done');
const logged = await db.select().from(activityLog).all();
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

section('Tabs scope the board');
const { createGroup, setGroupMembers, canUseGroup } = await import('../lib/groups');
const made = await createGroup(chris, 'Shop Floor');
check('an admin can make a tab', made.ok && made.groupId !== undefined);
const shopFloor = made.groupId!;
await setGroupMembers(chris, shopFloor, [shelly.id]);

check('a member may post to it', await canUseGroup(shelly, shopFloor));
check('an admin may post to any tab without being on it', await canUseGroup(chris, shopFloor));
check('someone left off it may not', !await canUseGroup(tony, shopFloor));
check(
  'and the machine refuses their task rather than filing it anyway',
  !(await machine.createTask(tony, {
    title: 'Sneaking in',
    notes: '',
    assignedTo: null,
    isAsap: false,
    dueLocal: null,
    rewardCents: null,
    groupId: shopFloor,
  })).ok,
);

const tabbed = await makeTask(chris, { title: 'Sweep the bay', groupId: shopFloor });
check('a tab task is on its own tab', (await board.upForGrabs(shopFloor)).some((t) => t.id === tabbed));
check('and not on the shared one', !(await board.upForGrabs(null)).some((t) => t.id === tabbed));
check(
  'the shared board is unchanged for tasks with no tab',
  (await board.upForGrabs(null)).every((t) => t.groupId === null),
);
const tabAsap = await makeTask(chris, { title: 'Tab ASAP', isAsap: true, groupId: shopFloor });
check('ASAP is per-tab too', (await board.asapTasks(shopFloor)).some((t) => t.id === tabAsap));
check('and stays off the shared ASAP row', !(await board.asapTasks(null)).some((t) => t.id === tabAsap));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
