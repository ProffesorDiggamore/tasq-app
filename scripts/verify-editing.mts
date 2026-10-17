/**
 * Changing your own PIN, editing a repeating task, and editing a task.
 *   npm run verify:editing
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tasq-edit-'));
process.env.TASQ_DB_PATH = path.join(tmp, 'verify.db');
process.env.SESSION_SECRET ??= 'x'.repeat(48);

const { initDatabase } = await import('../lib/db/migrate');
const { seedTestUsers } = await import('./helpers/test-users.mts');
const { db } = await import('../lib/db');
const { users, tasks, recurrences } = await import('../lib/db/schema');
const { hashPin, verifyPin } = await import('../lib/auth/pin');
const { changeOwnPin } = await import('../lib/change-pin');
const machine = await import('../lib/task-machine');
const rec = await import('../lib/recurrences');
const { localWallClockToUtc } = await import('../lib/time');
const { eq } = await import('drizzle-orm');
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
const tony = all.find((u) => u.name === 'Tony')!;
const shelly = all.find((u) => u.name === 'Shelly')!;

const reload = async (id: number) => (await db.select().from(users).where(eq(users.id, id)).get())!;
const taskRow = async (id: number) => (await db.select().from(tasks).where(eq(tasks.id, id)).get())!;

section('Changing your own PIN');
await db.update(users).set({ pinHash: await hashPin('1111') }).where(eq(users.id, tony.id)).run();

check(
  'the wrong current PIN is refused',
  !(await changeOwnPin(await reload(tony.id), '9999', '2222', '2222')).ok,
);
check('and the PIN is unchanged', await verifyPin('1111', (await reload(tony.id)).pinHash!));

check(
  'a mismatched confirmation is refused',
  !(await changeOwnPin(await reload(tony.id), '1111', '2222', '3333')).ok,
);
check('still unchanged', await verifyPin('1111', (await reload(tony.id)).pinHash!));

check(
  'a 3-digit new PIN is refused',
  !(await changeOwnPin(await reload(tony.id), '1111', '222', '222')).ok,
);
check(
  'reusing the same PIN is refused',
  !(await changeOwnPin(await reload(tony.id), '1111', '1111', '1111')).ok,
);

const changed = await changeOwnPin(await reload(tony.id), '1111', '2468', '2468');
check('the right current PIN changes it', changed.ok, changed.ok ? '' : changed.message);
check('the new PIN works', await verifyPin('2468', (await reload(tony.id)).pinHash!));
check('the old one does not', !(await verifyPin('1111', (await reload(tony.id)).pinHash!)));

const { activityLog } = await import('../lib/db/schema');
const pinEntries = (await db.select().from(activityLog).all()).filter((e) => e.verb === 'user.pin_changed');
check('History records the change', pinEntries.length === 1);
check('without leaking the PIN', !pinEntries[0].summary.includes('2468'));

section('The change is throttled like the login screen');
const { throttleState } = await import('../lib/auth/throttle');
for (let i = 0; i < 5; i += 1) await changeOwnPin(await reload(tony.id), '0000', '1234', '1234');
check('five wrong tries lock it', (await throttleState(tony.id)).locked);
const whileLocked = await changeOwnPin(await reload(tony.id), '2468', '1357', '1357');
check('even the correct PIN is refused while locked', !whileLocked.ok);
check('so the PIN is still the old one', await verifyPin('2468', (await reload(tony.id)).pinHash!));

section('Someone with no PIN yet');
check(
  'cannot change what does not exist',
  !(await changeOwnPin(await reload(shelly.id), '1111', '2222', '2222')).ok,
);

section('Two-step entry really is two steps');
// Regression guard: the keypad used to keep its digits after reporting an
// entry, so one 4-digit entry fired twice and a flow that asks for a PIN twice
// silently accepted the first entry as its own confirmation. The server is the
// backstop — it must reject a confirmation that never matched.
await db.update(users).set({ pinHash: await hashPin('4321') }).where(eq(users.id, shelly.id)).run();
check(
  'a confirmation that does not match is refused',
  !(await changeOwnPin(await reload(shelly.id), '4321', '1212', '3434')).ok,
);
check('the PIN survives that', await verifyPin('4321', (await reload(shelly.id)).pinHash!));
const shellyOk = await changeOwnPin(await reload(shelly.id), '4321', '1212', '1212');
check('a matching confirmation is accepted', shellyOk.ok);
check('and it took', await verifyPin('1212', (await reload(shelly.id)).pinHash!));

section('Editing a task');
const made = await machine.createTask(chris, {
  title: 'Grease the skid steer',
  notes: 'Blue cart',
  assignedTo: tony.id,
  isAsap: false,
  dueLocal: null,
  rewardCents: null,
});
const taskId = made.taskId!;
await machine.acceptTask(tony, taskId);

const outsider = await machine.updateTask(shelly, taskId, {
  title: 'Nope',
  notes: '',
  assignedTo: null,
  isAsap: false,
  dueLocal: null,
  rewardCents: null,
});
check('a bystander cannot edit it', !outsider.ok);

const renamed = await machine.updateTask(chris, taskId, {
  title: 'Grease the skid steer and the loader',
  notes: 'Blue cart. Zerks on the arms too.',
  assignedTo: tony.id,
  isAsap: false,
  dueLocal: null,
  rewardCents: null,
});
check('the creator can edit it', renamed.ok);
check('the title changed', (await taskRow(taskId)).title === 'Grease the skid steer and the loader');
check('the notes changed', (await taskRow(taskId)).notes?.includes('Zerks') === true);
check('a plain edit keeps the acceptance', (await taskRow(taskId)).status === 'accepted');
check('and notifies nobody', (renamed.notify ?? []).length === 0);

const audiences = (i: NotifyIntent[] | undefined) =>
  (i ?? []).map((n) => (n.audience.kind === 'user' ? `user:${n.audience.userId}` : n.audience.kind));

const reassigned = await machine.updateTask(chris, taskId, {
  title: 'Grease the skid steer and the loader',
  notes: '',
  assignedTo: shelly.id,
  isAsap: false,
  dueLocal: null,
  rewardCents: null,
});
check('reassigning works', reassigned.ok);
check('the new owner has it', (await taskRow(taskId)).assignedTo === shelly.id);
check('it drops back to pending so they must accept', (await taskRow(taskId)).status === 'pending');
check("the old owner's acceptance is cleared", (await taskRow(taskId)).acceptedAt === null);
check('the new owner is told', audiences(reassigned.notify).includes(`user:${shelly.id}`));

const toPool = await machine.updateTask(chris, taskId, {
  title: 'Grease the skid steer and the loader',
  notes: '',
  assignedTo: null,
  isAsap: false,
  dueLocal: null,
  rewardCents: null,
});
check('it can go back to the pool', toPool.ok && (await taskRow(taskId)).assignedTo === null);
check('as pending', (await taskRow(taskId)).status === 'pending');
check('with nobody notified', (toPool.notify ?? []).length === 0);

const madeAsap = await machine.updateTask(chris, taskId, {
  title: 'Grease the skid steer and the loader',
  notes: '',
  assignedTo: null,
  isAsap: true,
  dueLocal: null,
  rewardCents: null,
});
check('turning ASAP on tells everyone', audiences(madeAsap.notify).includes('everyone'));
const editedAgain = await machine.updateTask(chris, taskId, {
  title: 'Grease everything',
  notes: '',
  assignedTo: null,
  isAsap: true,
  dueLocal: null,
  rewardCents: null,
});
check('a later edit does not re-alert everyone', (editedAgain.notify ?? []).length === 0);

const { createGroup, setGroupMembers } = await import('../lib/groups');
const backRoom = (await createGroup(chris, 'Back Room')).groupId!;
await setGroupMembers(chris, backRoom, [shelly.id]);
const tabTask = await machine.createTask(chris, {
  title: 'Count the back-room till',
  notes: '',
  assignedTo: null,
  isAsap: false,
  dueLocal: null,
  rewardCents: null,
  groupId: backRoom,
});
const tabAsap = await machine.updateTask(chris, tabTask.taskId!, {
  title: 'Count the back-room till',
  notes: '',
  assignedTo: null,
  isAsap: true,
  dueLocal: null,
  rewardCents: null,
});
const tabAudience = tabAsap.notify?.[0]?.audience;
check(
  'turning ASAP on for a tab task tells only that tab',
  tabAsap.notify?.length === 1 && tabAudience?.kind === 'group' && tabAudience.groupId === backRoom,
  audiences(tabAsap.notify).join(),
);

section('Due times');
const future = localWallClockToUtc('2027-01-05', '09:00');
const withDue = await machine.updateTask(chris, taskId, {
  title: 'Grease everything',
  notes: '',
  assignedTo: null,
  isAsap: true,
  dueLocal: '2027-01-05T09:00',
  rewardCents: null,
});
check('a due time can be added', withDue.ok && (await taskRow(taskId)).dueAt === future);
await db.update(tasks).set({ overdueNotifiedAt: Date.now() }).where(eq(tasks.id, taskId)).run();
await machine.updateTask(chris, taskId, {
  title: 'Grease everything',
  notes: '',
  assignedTo: null,
  isAsap: true,
  dueLocal: '2027-02-05T09:00',
  rewardCents: null,
});
check(
  'pushing the due time out re-arms the overdue nudge',
  (await taskRow(taskId)).overdueNotifiedAt === null,
);
const cleared = await machine.updateTask(chris, taskId, {
  title: 'Grease everything',
  notes: '',
  assignedTo: null,
  isAsap: true,
  dueLocal: null,
  rewardCents: null,
});
check('and it can be cleared', cleared.ok && (await taskRow(taskId)).dueAt === null);

section('Finished work is not editable');
await machine.completeTask(chris, taskId);
check(
  'a done task refuses edits',
  !(await machine.updateTask(chris, taskId, {
    title: 'x',
    notes: '',
    assignedTo: null,
    isAsap: false,
    dueLocal: null,
    rewardCents: null,
  })).ok,
);

section('Editing a repeating task');
const rule = await rec.createRecurrence(
  chris,
  {
    title: 'Grease everything',
    notes: '',
    defaultAssignee: tony.id,
    isAsap: false,
    pattern: 'weekly',
    weekdays: [1],
    dayOfMonth: null,
    spawnTime: '07:00',
    rewardCents: null,
  },
  localWallClockToUtc('2026-05-04', '06:00'),
);
const ruleId = rule.recurrenceId!;
await rec.spawnDueRecurrences(localWallClockToUtc('2026-05-04', '07:00'));
const spawnedBefore = await db.select().from(tasks).where(eq(tasks.recurrenceId, ruleId)).all();
check('it spawned once', spawnedBefore.length === 1);

const edited = await rec.updateRecurrence(chris, ruleId, {
  title: 'Grease everything and check the tyres',
  notes: 'Grease gun is on the blue cart',
  defaultAssignee: shelly.id,
  isAsap: true,
  pattern: 'weekly',
  weekdays: [2, 4],
  dayOfMonth: null,
  spawnTime: '08:30',
  rewardCents: null,
});
check('the rule can be edited', edited.ok);
const ruleRow = (await db.select().from(recurrences).where(eq(recurrences.id, ruleId)).get())!;
check('the title changed', ruleRow.title === 'Grease everything and check the tyres');
check('the weekdays changed', ruleRow.weekdays === '2,4');
check('the time changed', ruleRow.spawnTime === '08:30');
check('the assignee changed', ruleRow.defaultAssignee === shelly.id);
check('ASAP changed', ruleRow.isAsap === true);

const stillOld = (await db.select().from(tasks).where(eq(tasks.id, spawnedBefore[0].id)).get())!;
check(
  'the copy already on the board is left alone',
  stillOld.title === 'Grease everything' && stillOld.assignedTo === tony.id,
);

check(
  'it no longer fires on the old weekday',
  !(await rec.spawnDueRecurrences(localWallClockToUtc('2026-05-11', '09:00'))).titles.includes(ruleRow.title),
);
check(
  'and does fire on a new one',
  (await rec.spawnDueRecurrences(localWallClockToUtc('2026-05-12', '09:00'))).titles.includes(ruleRow.title),
);

const summaries = (await db.select().from(activityLog).all()).map((e) => e.summary);
check(
  'History says what changed',
  summaries.some((s) => s.includes('renamed it from') && s.includes('Tuesdays and Thursdays')),
  summaries.filter((s) => s.includes('edited the repeating')).join(' | '),
);

section('Deleting a repeating task');
check('an invalid edit is refused', !(await rec.updateRecurrence(chris, ruleId, {
  title: '',
  notes: '',
  defaultAssignee: null,
  isAsap: false,
  pattern: 'weekly',
  weekdays: [2],
  dayOfMonth: null,
  spawnTime: '08:30',
  rewardCents: null,
})).ok);

check('it can be deleted', (await rec.deleteRecurrence(chris, ruleId)).ok);
check('it leaves the list', !(await rec.listRecurrences()).some((r) => r.id === ruleId));
check(
  'and stops spawning',
  !(await rec.spawnDueRecurrences(localWallClockToUtc('2026-05-19', '09:00'))).titles.includes(ruleRow.title),
);
check(
  'the tasks it already made survive',
  (await db.select().from(tasks).where(eq(tasks.recurrenceId, ruleId)).all()).length > 0,
);
check('deleting twice is refused', !(await rec.deleteRecurrence(chris, ruleId)).ok);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
