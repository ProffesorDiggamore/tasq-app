/**
 * Checks for history search + retention and the admin-only bounty rule.
 *   npx tsx scripts/verify-history-extras.mts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { NewTaskInput } from '../lib/board-types';
import { eq } from 'drizzle-orm';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tasq-hx-'));
process.env.TASQ_DB_PATH = path.join(tmp, 'verify.db');
process.env.SESSION_SECRET ??= 'x'.repeat(48);

const { initDatabase } = await import('../lib/db/migrate');
const { seedTestUsers } = await import('./helpers/test-users.mts');
const { db } = await import('../lib/db');
const { activityLog } = await import('../lib/db/schema');
const history = await import('../lib/history');
const machine = await import('../lib/task-machine');

let failures = 0;
const check = (label: string, cond: boolean, detail = ''): void => {
  if (cond) console.log(`  ok    ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

initDatabase();
seedTestUsers();
const { users, tasks } = await import('../lib/db/schema');
const all = db.select().from(users).all();
const admin = all.find((u) => u.isAdmin)!;
const worker = all.find((u) => !u.isAdmin)!;

const now = Date.now();
const insert = (actorId: number | null, summary: string, ageDays: number) =>
  db.insert(activityLog).values({
    actorId, verb: 'task.done', subjectType: 'task', subjectId: null, summary,
    createdAt: now - ageDays * 86_400_000,
  }).run();

insert(worker.id, 'Chris finished "Grease the skid steer"', 1);
insert(worker.id, 'Chris finished "Restock paper towels"', 3);
insert(admin.id, 'Landon added "Pressure wash the lot"', 2);
insert(null, 'scheduler spawned "Open the shop"', 1);
insert(worker.id, 'Chris finished "Ancient entry"', 45);

const section = (n: string) => console.log(`\n${n}`);

section('Search');
check('matches words in the summary', history.loadHistory({ range: 'all', actorId: null, text: 'skid' }).total === 1);
check('matches actor name', history.loadHistory({ range: 'all', actorId: null, text: 'Tony' }).total === 0, 'Tony did nothing');
check('matches actor name on their entries', history.loadHistory({ range: 'all', actorId: null, text: 'Chris' }).total === 4, `got ${history.loadHistory({ range: 'all', actorId: null, text: 'Chris' }).total}`);
check('combines with the person filter', history.loadHistory({ range: 'all', actorId: worker.id, text: 'towels' }).total === 1);
check('no hit returns zero', history.loadHistory({ range: 'all', actorId: null, text: 'xyzzynoop' }).total === 0);
check('% in the query is literal, not a wildcard', history.loadHistory({ range: 'all', actorId: null, text: '%' }).total === 0);

section('Retention');
const r1 = history.pruneHistory(now);
check('entries older than 30 days are deleted', r1.removed === 1);
check('recent entries survive', history.loadHistory({ range: 'all', actorId: null }).total === 4);
const r2 = history.pruneHistory(now);
check('second call within the hour is a no-op', r2.removed === 0);
// Force the hourly gate open and confirm nothing else goes while under 1 GB.
history.__resetPruneGateForTests?.();
const r3 = history.pruneHistory(now);
check('under the 1 GB cap nothing more is dropped', r3.removed === 0);

const getTask = (id: number) => db.select().from(tasks).where(eq(tasks.id, id)).get()!;

section('Admin-only bounty');
const input = (rewardCents: number | null): NewTaskInput => ({
  title: 'Bounty task', notes: '', assignedTo: null, isAsap: false, dueLocal: null, rewardCents,
});
const crew = machine.createTask(worker, input(5000), now);
check('a non-admin may post a task', crew.ok);
check(
  'but their bounty is dropped, not honoured',
  crew.ok && crew.taskId !== undefined && getTask(crew.taskId).rewardCents === null,
);
const t = machine.createTask(admin, input(5000), now);
check('admin creates a $50 bounty', t.ok && t.taskId !== undefined);
if (t.ok && t.taskId !== undefined) {
  const before = getTask(t.taskId);
  // A non-admin tries to grab the money out of someone's task.
  const edit = machine.updateTask(worker, t.taskId, input(0), now);
  const after = getTask(t.taskId);
  check('non-admin cannot edit someone else’s task', !edit.ok);
  check('bounty untouched', after.rewardCents === before.rewardCents && after.rewardCents === 5000, `reward now ${after.rewardCents}`);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
