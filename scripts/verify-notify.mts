/**
 * Who gets told what. The status machine returns notification *intents* rather
 * than sending, so this asserts on the exact audience and copy without a push
 * service in the loop.
 *   npm run verify:notify
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-notify-'));
process.env.APEX_DB_PATH = path.join(tmp, 'verify.db');
process.env.SESSION_SECRET ??= 'x'.repeat(48);

const { migrateAndSeed } = await import('../lib/db/migrate');
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

migrateAndSeed();
const all = db.select().from(users).all();
const chris = all.find((u) => u.name === 'Chris')!;
const landon = all.find((u) => u.name === 'Landon')!;
const tony = all.find((u) => u.name === 'Tony')!;

const mk = (actor = chris, o: Record<string, unknown> = {}) =>
  machine.createTask(actor, {
    title: 'Task',
    notes: '',
    assignedTo: null,
    isAsap: false,
    dueLocal: null,
    ...o,
  });

const audiences = (intents: NotifyIntent[] | undefined) =>
  (intents ?? []).map((i) =>
    i.audience.kind === 'user' ? `user:${i.audience.userId}` : i.audience.kind,
  );

section('Assigning');
const assigned = mk(chris, { title: 'Grease the skid steer', assignedTo: tony.id });
check('the assignee is told', audiences(assigned.notify).includes(`user:${tony.id}`));
check('and only them', audiences(assigned.notify).length === 1, audiences(assigned.notify).join(','));
check('the body is the task title', assigned.notify![0].body === 'Grease the skid steer');
check('it deep-links to the task', assigned.notify![0].url === `/?task=${assigned.taskId}`);

const self = mk(tony, { title: 'My own errand', assignedTo: tony.id });
check('assigning to yourself notifies nobody', (self.notify ?? []).length === 0);

const pooled = mk(chris, { title: 'Sweep the yard' });
check('a pool task notifies nobody on its own', (pooled.notify ?? []).length === 0);

section('ASAP');
const asap = mk(chris, { title: 'Rent is due at 9', isAsap: true });
check('everyone is told', audiences(asap.notify).includes('everyone'));
check('the creator is excluded', asap.notify!.some((i) => i.audience.kind === 'everyone' && i.audience.except === chris.id));
check('it is marked urgent', asap.notify![0].urgent === true);

const asapAssigned = mk(chris, { title: 'Truck out by 8', isAsap: true, assignedTo: landon.id });
check('an assigned ASAP tells the owner directly', audiences(asapAssigned.notify).includes(`user:${landon.id}`));
check('and still tells everyone else', audiences(asapAssigned.notify).includes('everyone'));

section('Declining');
machine.acceptTask(tony, assigned.taskId!);
const declined = machine.declineTask(tony, assigned.taskId!, 'On a delivery until 3');
check('the creator is told', audiences(declined.notify).includes(`user:${chris.id}`));
check('the reason is carried through', declined.notify![0].body.includes('On a delivery until 3'));

const ownTask = mk(tony, { title: 'Tony asked Tony', assignedTo: tony.id });
const ownDecline = machine.declineTask(tony, ownTask.taskId!, '');
check('declining your own task notifies nobody', (ownDecline.notify ?? []).length === 0);

section('Quiet transitions');
check('accepting notifies nobody', (machine.acceptTask(landon, asapAssigned.taskId!).notify ?? []).length === 0);
check('claiming notifies nobody', (machine.claimTask(landon, pooled.taskId!).notify ?? []).length === 0);
check('completing notifies nobody', (machine.completeTask(landon, pooled.taskId!).notify ?? []).length === 0);

section('Supplies');
const request = supplies.createSupplyRequest(tony, { item: 'Grease', quantity: '2 tubes', notes: '' });
check('admins are told about a new request', audiences(request.notify).includes('admins'));
check('the body reads item — requester', request.notify![0].body === 'Grease (2 tubes) — Tony');

const ordered = supplies.advanceSupplyRequest(chris, request.requestId!, 'ordered');
check('the requester is told it was ordered', audiences(ordered.notify).includes(`user:${tony.id}`));
const received = supplies.advanceSupplyRequest(chris, request.requestId!, 'received');
check('and told again when it arrives', audiences(received.notify).includes(`user:${tony.id}`));

const own = supplies.createSupplyRequest(chris, { item: 'Wipes', quantity: '', notes: '' });
const selfAdvance = supplies.advanceSupplyRequest(chris, own.requestId!, 'ordered');
check("an admin advancing their own request tells nobody", (selfAdvance.notify ?? []).length === 0);

const skipped = supplies.advanceSupplyRequest(chris, own.requestId!, 'received');
check('one step at a time is enforced', skipped.ok);
const jump = supplies.createSupplyRequest(tony, { item: 'Rags', quantity: '', notes: '' });
check('cannot jump requested straight to received', !supplies.advanceSupplyRequest(chris, jump.requestId!, 'received').ok);
check('a non-admin cannot advance anything', !supplies.advanceSupplyRequest(tony, jump.requestId!, 'ordered').ok);

section('Supply queue ordering');
const queue = supplies.supplyQueue();
check('outstanding requests are grouped', queue.requested.every((r) => r.status === 'requested'));
check('oldest outstanding leads', queue.requested.length < 2 || queue.requested[0].createdAt <= queue.requested[1].createdAt);
check('the badge counts only what still needs ordering', supplies.outstandingSupplyCount() === queue.requested.length);

section('History');
const week = history.loadHistory({ range: 'week', actorId: null });
check('this week has entries', week.days.length > 0);
check('newest day first', week.days.length < 2 || week.days[0].date >= week.days[1].date);
check('entries within a day are newest first', week.days[0].entries.length < 2 || week.days[0].entries[0].createdAt >= week.days[0].entries[1].createdAt);

const byTony = history.loadHistory({ range: 'all', actorId: tony.id });
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
