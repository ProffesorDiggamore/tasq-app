import 'server-only';
import { and, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';

/**
 * Finds tasks whose due time has passed while they are still open, and marks
 * them so the nudge goes out exactly once.
 *
 * `overdue_notified_at` is the guard: the row is stamped in the same query that
 * selects it, so a tick that overlaps the previous one cannot double-notify.
 * Phase 8 hangs the actual push off the ids this returns.
 */
export async function markOverdueTasks(now: number = Date.now()): Promise<number[]> {
  const due = db
    .select({ id: tasks.id, assignedTo: tasks.assignedTo, title: tasks.title })
    .from(tasks)
    .where(
      and(
        isNotNull(tasks.dueAt),
        lt(tasks.dueAt, now),
        isNull(tasks.overdueNotifiedAt),
        inArray(tasks.status, ['pending', 'accepted']),
      ),
    )
    .all();

  if (due.length === 0) return [];

  const claimed: number[] = [];
  for (const task of due) {
    const result = db
      .update(tasks)
      .set({ overdueNotifiedAt: now })
      .where(and(inArray(tasks.id, [task.id]), isNull(tasks.overdueNotifiedAt)))
      .run();
    if (result.changes === 1) claimed.push(task.id);
  }

  const { notifyOverdue } = await import('@/lib/notify');
  await notifyOverdue(claimed);
  return claimed;
}
