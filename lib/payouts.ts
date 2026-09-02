import 'server-only';
import { and, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tasks, users, type User } from '@/lib/db/schema';
import { logActivity } from '@/lib/activity';
import { fail, ok, type ActionResult } from '@/lib/action-result';
import type { PayoutPerson, PayoutTask } from '@/lib/board-types';

/**
 * What the shop owes, derived rather than tracked.
 *
 * There is no ledger table: a debt is simply a finished task that carried a
 * bounty and has not been marked paid, so nothing can drift out of step with
 * the board. Settling stamps the tasks; History keeps the record. Anyone owed
 * nothing has no rows at all and never appears on the screen — the list is the
 * answer to "who do I still owe", not a roster.
 */

/** Done, carried money, nobody has been paid for it yet. */
const unpaid = and(
  eq(tasks.status, 'done'),
  isNotNull(tasks.completedBy),
  isNotNull(tasks.rewardCents),
  gt(tasks.rewardCents, 0),
  isNull(tasks.rewardPaidAt),
);

/** Everyone still owed something, biggest debt first. Never returns a zero. */
export function outstandingPayouts(): PayoutPerson[] {
  const rows = db
    .select({
      userId: tasks.completedBy,
      name: users.name,
      cents: sql<number>`sum(${tasks.rewardCents})`,
      count: sql<number>`count(*)`,
      oldest: sql<number>`min(${tasks.completedAt})`,
    })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.completedBy))
    .where(unpaid)
    .groupBy(tasks.completedBy, users.name)
    .all();

  return rows
    .filter((r) => r.userId !== null && r.cents > 0)
    .map((r) => ({
      userId: r.userId as number,
      name: r.name,
      cents: r.cents,
      taskCount: r.count,
      oldestAt: r.oldest,
      tasks: unpaidTasksFor(r.userId as number),
    }))
    .sort((a, b) => b.cents - a.cents);
}

/** The individual jobs behind one person's total, oldest first. */
export function unpaidTasksFor(userId: number): PayoutTask[] {
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      rewardCents: tasks.rewardCents,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(and(unpaid, eq(tasks.completedBy, userId)))
    .orderBy(sql`${tasks.completedAt} asc`)
    .all()
    .map((t) => ({
      id: t.id,
      title: t.title,
      rewardCents: t.rewardCents ?? 0,
      completedAt: t.completedAt ?? 0,
    }));
}

/** Total across everyone, for the badge on the Settings link. */
export function totalOwedCents(): number {
  const row = db
    .select({ cents: sql<number>`coalesce(sum(${tasks.rewardCents}), 0)` })
    .from(tasks)
    .where(unpaid)
    .get();
  return row?.cents ?? 0;
}

/**
 * Settle everything one person is owed, in one stamp. Guarded on the same
 * unpaid condition it read, so paying twice in two taps cannot double-stamp —
 * the second one finds nothing and says so.
 */
export function markPersonPaid(
  admin: User,
  userId: number,
  now: number = Date.now(),
): ActionResult & { cents?: number } {
  const owed = unpaidTasksFor(userId);
  if (owed.length === 0) return fail('Nothing outstanding for them.');

  const person = db.select().from(users).where(eq(users.id, userId)).get();
  const cents = owed.reduce((sum, t) => sum + t.rewardCents, 0);

  const result = db
    .update(tasks)
    .set({ rewardPaidAt: now, rewardPaidBy: admin.id })
    .where(and(unpaid, eq(tasks.completedBy, userId)))
    .run();
  if (result.changes === 0) return fail('Someone just settled that.');

  logActivity(
    {
      actorId: admin.id,
      verb: 'payout.settled',
      subjectType: 'user',
      subjectId: userId,
      summary: `${admin.name} paid ${person?.name ?? 'someone'} ${formatCents(cents)} for ${
        owed.length
      } ${owed.length === 1 ? 'task' : 'tasks'}`,
    },
    now,
  );

  return { ...ok, cents };
}

/** Settle one job on its own, for the case where a bounty is paid piecemeal. */
export function markTaskPaid(
  admin: User,
  taskId: number,
  now: number = Date.now(),
): ActionResult {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return fail('That task is gone.');

  const result = db
    .update(tasks)
    .set({ rewardPaidAt: now, rewardPaidBy: admin.id })
    .where(and(unpaid, eq(tasks.id, taskId)))
    .run();
  if (result.changes === 0) return fail('That one is already settled.');

  const who = task.completedBy
    ? db.select({ name: users.name }).from(users).where(eq(users.id, task.completedBy)).get()?.name
    : null;

  logActivity(
    {
      actorId: admin.id,
      verb: 'payout.settled',
      subjectType: 'task',
      subjectId: taskId,
      summary: `${admin.name} paid ${who ?? 'someone'} ${formatCents(
        task.rewardCents ?? 0,
      )} for "${task.title}"`,
    },
    now,
  );
  return ok;
}

/** Whole dollars stay whole — "$25", not "$25.00". */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
