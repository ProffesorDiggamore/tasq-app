/**
 * Who gets told what. The status machine returns notification *intents* rather
 * than sending, so this asserts on the exact audience and copy without a push
 * service in the loop.
 *   npm run verify:notify
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tasq-notify-'));
process.env.TASQ_DB_PATH = path.join(tmp, 'verify.db');
process.env.SESSION_SECRET ??= 'x'.repeat(48);

const { initDatabase } = await import('../lib/db/migrate');
const { seedTestUsers } = await import('./helpers/test-users.mts');
const { db } = await import('../lib/db');
const { users } = await import('../lib/db/schema');
const machine = await import('../lib/task-machine');
const supplies = await import('../lib/supplies');
const history = await import('../lib/history');
const { localWallClockToUtc } = await import('../lib/time');
import type { NotifyIntent } from '../lib/board-types';

let failures = 0;
const check = (label: string, cond: boolean, detail = ''): void => {
  if (cond) console.log(`  ok    ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};
const section = (n: string) => console.log(`\n${n}`);

await initDatabase();
await seedTestUsers();
const all = await db.select().from(users).all();
const chris = all.find((u) => u.name === 'Chris')!;
const landon = all.find((u) => u.name === 'Landon')!;
const tony = all.find((u) => u.name === 'Tony')!;

const mk = async (actor = chris, o: Record<string, unknown> = {}) =>
  await machine.createTask(actor, {
    title: 'Task',
    notes: '',
    assignedTo: null,
    isAsap: false,
    dueLocal: null,
    rewardCents: null,
    ...o,
  });

const audiences = (intents: NotifyIntent[] | undefined) =>
  (intents ?? []).map((i) =>
    i.audience.kind === 'user' ? `user:${i.audience.userId}` : i.audience.kind,
  );

section('Assigning');
const assigned = await mk(chris, { title: 'Grease the skid steer', assignedTo: tony.id });
check('the assignee is told', audiences(assigned.notify).includes(`user:${tony.id}`));
check('and only them', audiences(assigned.notify).length === 1, audiences(assigned.notify).join(','));
check('the body leads with the task title', assigned.notify![0].body === 'Grease the skid steer');
check('the heading says what kind it is', assigned.notify![0].title === 'You Have A New Tasq!');
check('it deep-links to the task', assigned.notify![0].url === `/?task=${assigned.taskId}`);

const self = await mk(tony, { title: 'My own errand', assignedTo: tony.id });
check('assigning to yourself buzzes you too', audiences(self.notify).includes(`user:${tony.id}`));
check('under its own rule', self.notify![0].event === 'task.self-assigned');
check('and reads as a receipt, not an order', self.notify![0].title === 'You Added A Tasq!');
check('while assigning someone else does not', assigned.notify![0].event === 'task.assigned');

const pooled = await mk(chris, { title: 'Sweep the yard' });
check('a pool task notifies nobody on its own', (pooled.notify ?? []).length === 0);

section('ASAP');
const asap = await mk(chris, { title: 'Rent is due at 9', isAsap: true });
check('everyone is told', audiences(asap.notify).includes('everyone'));
check('the creator is excluded', asap.notify!.some((i) => i.audience.kind === 'everyone' && i.audience.except === chris.id));
check('it is marked urgent', asap.notify![0].urgent === true);

const asapAssigned = await mk(chris, { title: 'Truck out by 8', isAsap: true, assignedTo: landon.id });
check('an assigned ASAP tells the owner directly', audiences(asapAssigned.notify).includes(`user:${landon.id}`));
check('and still tells everyone else', audiences(asapAssigned.notify).includes('everyone'));

section('Declining');
await machine.acceptTask(tony, assigned.taskId!);
const declined = await machine.declineTask(tony, assigned.taskId!, 'On a delivery until 3');
check('the creator is told', audiences(declined.notify).includes(`user:${chris.id}`));
check('the reason is carried through', declined.notify![0].body.includes('On a delivery until 3'));

const ownTask = await mk(tony, { title: 'Tony asked Tony', assignedTo: tony.id });
const ownDecline = await machine.declineTask(tony, ownTask.taskId!, '');
check('declining your own task notifies nobody', (ownDecline.notify ?? []).length === 0);

section('What the admins hear');
const accepted = await machine.acceptTask(landon, asapAssigned.taskId!);
check('accepting tells the admins', audiences(accepted.notify).includes('admins'));
check('naming who took it', accepted.notify![0].body.endsWith('\nby Landon'), accepted.notify![0].body);
check(
  'and never the admin who did it themselves',
  accepted.notify![0].audience.kind === 'admins' && accepted.notify![0].audience.except === landon.id,
);

const claimed = await machine.claimTask(landon, pooled.taskId!);
check('grabbing an open task tells them too', audiences(claimed.notify).includes('admins'));

const done = await machine.completeTask(landon, pooled.taskId!);
check('so does finishing one', audiences(done.notify).includes('admins'));
check('an unpaid task just names who did it', done.notify![0].body.endsWith('\nby Landon'), done.notify![0].body);

const paid = await mk(chris, { title: 'Pour the pad', assignedTo: landon.id, rewardCents: 2500 });
const paidDone = await machine.completeTask(landon, paid.taskId!);
check(
  'a paid one says what it paid and who did it',
  paidDone.notify![0].body === 'Pour the pad\n$25 by Landon',
  paidDone.notify![0].body,
);
check('under one heading for every finished tasq', paidDone.notify![0].title === 'A Tasq Was Done!');

const odd = await mk(chris, { title: 'Half job', assignedTo: landon.id, rewardCents: 1250 });
check(
  'cents survive the rounding',
  (await machine.completeTask(landon, odd.taskId!)).notify![0].body.includes('$12.50 by Landon'),
);

section('The line under the title');
const bounty = await mk(chris, { title: 'Pull the forms', assignedTo: tony.id, rewardCents: 4000 });
check('money wins when there is money', bounty.notify![0].body === 'Pull the forms\n$40', bounty.notify![0].body);

const dated = await mk(chris, {
  title: 'Load the trailer',
  assignedTo: tony.id,
  dueLocal: '2026-09-18T15:00',
});
check(
  'otherwise the deadline',
  /^Load the trailer\nDue Fri 3:00\u202fPM$|^Load the trailer\nDue Fri 3:00 PM$/.test(dated.notify![0].body),
  dated.notify![0].body,
);

const noted = await mk(chris, { title: 'Sweep out the bay', assignedTo: tony.id, notes: 'Behind the saw' });
check('otherwise the note', noted.notify![0].body === 'Sweep out the bay\nBehind the saw', noted.notify![0].body);

const bare = await mk(chris, { title: 'Lock up', assignedTo: tony.id });
check('and otherwise nothing at all', bare.notify![0].body === 'Lock up', bare.notify![0].body);

section("The admin's rules");
const policy = await import('../lib/notify-policy');
check('every rule is on until someone says otherwise', Object.values(await policy.getNotifyPolicy()).every(Boolean));
check('turning one off sticks', await policy.setNotifyRule('task.completed', false) && !await policy.notifyEnabled('task.completed'));
check('and leaves the rest alone', await policy.notifyEnabled('task.assigned'));
check('a rule nobody defined is refused', !await policy.setNotifyRule('made.up' as never, false));
await policy.setNotifyRule('task.completed', true);

section('Supplies');
const request = await supplies.createSupplyRequest(tony, { item: 'Grease', quantity: '2 tubes', notes: '' });
check('admins are told about a new request', audiences(request.notify).includes('admins'));
check(
  'the body reads item, then how many and who',
  request.notify![0].body === 'Grease\n2 tubes · asked by Tony',
  request.notify![0].body,
);

const ordered = await supplies.advanceSupplyRequest(chris, request.requestId!, 'ordered');
check('the requester is told it was ordered', audiences(ordered.notify).includes(`user:${tony.id}`));
const received = await supplies.advanceSupplyRequest(chris, request.requestId!, 'received');
check('and told again when it arrives', audiences(received.notify).includes(`user:${tony.id}`));

const own = await supplies.createSupplyRequest(chris, { item: 'Wipes', quantity: '', notes: '' });
const selfAdvance = await supplies.advanceSupplyRequest(chris, own.requestId!, 'ordered');
check("an admin advancing their own request tells nobody", (selfAdvance.notify ?? []).length === 0);

const skipped = await supplies.advanceSupplyRequest(chris, own.requestId!, 'received');
check('one step at a time is enforced', skipped.ok);
const jump = await supplies.createSupplyRequest(tony, { item: 'Rags', quantity: '', notes: '' });
check('cannot jump requested straight to received', !(await supplies.advanceSupplyRequest(chris, jump.requestId!, 'received')).ok);
check('a non-admin cannot advance anything', !(await supplies.advanceSupplyRequest(tony, jump.requestId!, 'ordered')).ok);

section('Supply queue ordering');
const queue = await supplies.supplyQueue();
check('outstanding requests are grouped', queue.requested.every((r) => r.status === 'requested'));
check('oldest outstanding leads', queue.requested.length < 2 || queue.requested[0].createdAt <= queue.requested[1].createdAt);
check('the badge counts only what still needs ordering', await supplies.outstandingSupplyCount() === queue.requested.length);

section('History');
const week = await history.loadHistory({ range: 'week', actorId: null });
check('this week has entries', week.days.length > 0);
check('newest day first', week.days.length < 2 || week.days[0].date >= week.days[1].date);
check('entries within a day are newest first', week.days[0].entries.length < 2 || week.days[0].entries[0].createdAt >= week.days[0].entries[1].createdAt);

const byTony = await history.loadHistory({ range: 'all', actorId: tony.id });
check('filtering by person works', byTony.days.every((d) => d.entries.every((e) => e.actorId === tony.id)));
check('and finds something', byTony.days.length > 0);

const summaries = week.days.flatMap((d) => d.entries.map((e) => e.summary));
check('supply moves are in History', summaries.some((s) => s.includes('marked Grease')));
check(
  'a person filter never picks up the scheduler\'s own entries',
  byTony.days.every((d) => d.entries.every((e) => e.actorId !== null)),
);

const noon = localWallClockToUtc('2026-05-06', '12:00');
check('today starts at local midnight', history.rangeStart('today', noon) === localWallClockToUtc('2026-05-06', '00:00'));
check('the week starts on Monday', history.rangeStart('week', noon) === localWallClockToUtc('2026-05-04', '00:00'));
const monday = localWallClockToUtc('2026-05-04', '09:00');
check('on a Monday the week starts that morning', history.rangeStart('week', monday) === localWallClockToUtc('2026-05-04', '00:00'));
const sunday = localWallClockToUtc('2026-05-10', '09:00');
check('on a Sunday the week still starts the previous Monday', history.rangeStart('week', sunday) === localWallClockToUtc('2026-05-04', '00:00'));
check('everything has no lower bound', history.rangeStart('all', noon) === null);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
