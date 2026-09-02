import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tasks, users, type User } from '@/lib/db/schema';
import { canUseGroup } from '@/lib/groups';
import { logActivity } from '@/lib/activity';
import { localWallClockToUtc } from '@/lib/time';
import type { NewTaskInput, NotifyIntent, TaskActionResult } from '@/lib/board-types';

/**
 * The task status machine, kept free of request context so every transition can
 * be exercised directly (see scripts/verify-tasks.mts). The server actions in
 * app/actions.ts do nothing but resolve who is asking and revalidate afterwards.
 *
 * Every transition is a conditional UPDATE guarded on the state it expects to
 * find. Two people acting in the same second is normal on a shared board, so a
 * miss is explained rather than thrown.
 *
 * Transitions return the notifications they *want sent* rather than sending
 * them. That keeps the machine synchronous and lets the verification script
 * assert on exactly who would be told what, without a push service in the loop.
 */
export type MachineResult = TaskActionResult & { notify?: NotifyIntent[]; code?: string };

const TITLE_MAX = 120;
const NOTES_MAX = 4000;
const REASON_MAX = 280;

function nameOf(userId: number): string {
  return (
    db.select({ name: users.name }).from(users).where(eq(users.id, userId)).get()?.name ?? 'Someone'
  );
}

function explainMiss(taskId: number): TaskActionResult & { code?: string } {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return { ok: false, reason: 'gone', code: 'TASQ-E0201' };

  if (task.status === 'cancelled') {
    return { ok: false, reason: 'stale', code: 'TASQ-E0202', message: 'That task was cancelled.' };
  }
  if (task.status === 'done') {
    const by = task.completedBy ? nameOf(task.completedBy) : null;
    return {
      ok: false,
      reason: 'stale',
      code: 'TASQ-E0203',
      message: by ? `${by} already finished that one.` : 'That task is already done.',
    };
  }
  if (task.assignedTo !== null) {
    return { ok: false, reason: 'claimed', code: 'TASQ-E0204', by: nameOf(task.assignedTo) };
  }
  return { ok: false, reason: 'stale', code: 'TASQ-E0211', message: 'That task moved — pull down to refresh.' };
}

function clean(value: string, max: number): string {
  return value.trim().slice(0, max);
}

/** Rewards are whole dollars up to $500; anything else is no bounty at all. */
function normalizeReward(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return null;
  const whole = Math.floor(cents);
  if (whole <= 0 || whole > 50_000) return null;
  return whole;
}

function rewardSuffix(cents: number | null): string {
  return cents ? ` for $${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}` : '';
}

export function createTask(
  actor: User,
  input: NewTaskInput,
  now: number = Date.now(),
): MachineResult & { taskId?: number } {
  // Anyone on the board can post work — to the shared Tasqs tab, or to a tab
  // they are in. What stays the owner's alone is money: a bounty is spending,
  // so a non-admin's reward is dropped rather than the whole task refused.
  const groupId = input.groupId ?? null;
  if (!canUseGroup(actor, groupId)) {
    return {
      ok: false,
      reason: 'invalid',
      code: 'TASQ-E0212',
      message: 'That tab is gone, or you are not on it.',
    };
  }
  const rewardCents = actor.isAdmin ? normalizeReward(input.rewardCents) : null;
  const title = clean(input.title, TITLE_MAX);
  if (title.length === 0) return { ok: false, reason: 'invalid', code: 'TASQ-E0206', message: 'Give it a title.' };
  const notes = clean(input.notes, NOTES_MAX) || null;

  let assignedTo: number | null = null;
  if (input.assignedTo !== null) {
    const target = db
      .select()
      .from(users)
      .where(and(eq(users.id, input.assignedTo), isNull(users.archivedAt)))
      .get();
    if (!target) {
      return { ok: false, reason: 'invalid', code: 'TASQ-E0207', message: 'That person is no longer on the board.' };
    }
    assignedTo = target.id;
  }

  // The picker hands back shop wall-clock time. Converting here rather than in
  // the browser keeps a phone that has travelled from renumbering the board.
  let dueAt: number | null = null;
  if (input.dueLocal) {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(input.dueLocal);
    if (!match) return { ok: false, reason: 'invalid', code: 'TASQ-E0208', message: "That due time didn't parse." };
    dueAt = localWallClockToUtc(match[1], match[2]);
  }

  const created = db
    .insert(tasks)
    .values({
      title,
      notes,
      createdBy: actor.id,
      assignedTo,
      groupId,
      isAsap: input.isAsap,
      dueAt,
      rewardCents,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: tasks.id })
    .get();

  logActivity(
    {
      actorId: actor.id,
      verb: assignedTo === null ? 'task.created' : 'task.assigned',
      subjectType: 'task',
      subjectId: created.id,
      summary:
        assignedTo === null
          ? `${actor.name} put "${title}" up for grabs${rewardSuffix(rewardCents)}${
              input.isAsap ? ' (ASAP)' : ''
            }`
          : `${actor.name} assigned "${title}" to ${nameOf(assignedTo)}${rewardSuffix(
              rewardCents,
            )}${input.isAsap ? ' (ASAP)' : ''}`,
    },
    now,
  );

  const notify: NotifyIntent[] = [];
  const url = `/?task=${created.id}`;
  if (assignedTo !== null && assignedTo !== actor.id) {
    notify.push({
      audience: { kind: 'user', userId: assignedTo },
      title: input.isAsap ? 'ASAP — for you' : `${actor.name} assigned you a task`,
      body: title,
      url,
      tag: `task-${created.id}`,
      urgent: input.isAsap,
    });
  }
  if (input.isAsap) {
    // ASAP is the shared row, so everyone hears about it — except whoever just
    // typed it, and without doubling up on an assignee already told above. On a
    // group tab "everyone" means everyone who can see that tab.
    notify.push({
      audience:
        groupId === null
          ? { kind: 'everyone', except: actor.id }
          : { kind: 'group', groupId, except: actor.id },
      title: 'ASAP',
      body: title,
      url,
      tag: `task-${created.id}`,
      urgent: true,
    });
  }

  return { ok: true, taskId: created.id, notify };
}

/**
 * Edit a task after it exists. Restricted to the creator or an admin — the same
 * bar as cancelling, since retitling someone's work is the same kind of act.
 *
 * Reassigning deliberately drops the task back to `pending`: the new owner has
 * not agreed to anything yet, and inheriting someone else's acceptance would
 * mean the board claims a person took work they have never seen.
 */
export function updateTask(
  actor: User,
  taskId: number,
  input: NewTaskInput,
  now: number = Date.now(),
): MachineResult {
  const existing = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!existing) return { ok: false, reason: 'gone' };
  if (existing.createdBy !== actor.id && !actor.isAdmin) {
    return {
      ok: false,
      reason: 'invalid',
      code: 'TASQ-E0209',
      message: `Only ${nameOf(existing.createdBy)} or an admin can edit that.`,
    };
  }
  if (existing.status === 'done' || existing.status === 'cancelled') {
    return {
      ok: false,
      reason: 'stale',
      code: existing.status === 'done' ? 'TASQ-E0203' : 'TASQ-E0202',
      message: `That task is already ${existing.status}. Put it back first.`,
    };
  }

  const title = clean(input.title, TITLE_MAX);
  if (title.length === 0) return { ok: false, reason: 'invalid', code: 'TASQ-E0206', message: 'Give it a title.' };
  const notes = clean(input.notes, NOTES_MAX) || null;

  let assignedTo: number | null = null;
  if (input.assignedTo !== null) {
    const target = db
      .select()
      .from(users)
      .where(and(eq(users.id, input.assignedTo), isNull(users.archivedAt)))
      .get();
    if (!target) {
      return { ok: false, reason: 'invalid', code: 'TASQ-E0207', message: 'That person is no longer on the board.' };
    }
    assignedTo = target.id;
  }

  let dueAt: number | null = null;
  if (input.dueLocal) {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(input.dueLocal);
    if (!match) return { ok: false, reason: 'invalid', code: 'TASQ-E0208', message: "That due time didn't parse." };
    dueAt = localWallClockToUtc(match[1], match[2]);
  }

  const reassigned = assignedTo !== existing.assignedTo;
  const status = reassigned ? 'pending' : existing.status;
  // A due time pushed into the future earns a fresh nudge.
  const overdueNotifiedAt = dueAt !== null && dueAt > now ? null : existing.overdueNotifiedAt;

  // Money is an admin decision: a non-admin creator editing their own task
  // keeps whatever bounty it already had, whatever the form sent.
  const rewardCents = actor.isAdmin ? normalizeReward(input.rewardCents) : existing.rewardCents;

  const result = db
    .update(tasks)
    .set({
      title,
      notes,
      assignedTo,
      isAsap: input.isAsap,
      dueAt,
      rewardCents,
      status,
      acceptedAt: reassigned ? null : existing.acceptedAt,
      claimedAt: reassigned ? null : existing.claimedAt,
      overdueNotifiedAt,
      updatedAt: now,
    })
    // Guarded on the status we read, so an edit cannot land on top of someone
    // else finishing or cancelling the task a moment earlier.
    .where(and(eq(tasks.id, taskId), eq(tasks.status, existing.status)))
    .run();
  if (result.changes === 0) return explainMiss(taskId);

  const changes: string[] = [];
  if (title !== existing.title) changes.push(`renamed it from "${existing.title}"`);
  if (reassigned) {
    changes.push(assignedTo === null ? 'put it up for grabs' : `gave it to ${nameOf(assignedTo)}`);
  }
  if (input.isAsap !== existing.isAsap) {
    changes.push(input.isAsap ? 'marked it ASAP' : 'took ASAP off it');
  }
  if (dueAt !== existing.dueAt) changes.push(dueAt === null ? 'cleared the due time' : 'changed the due time');
  {
    const nextReward = rewardCents;
    const prevSuffix = rewardSuffix(existing.rewardCents ?? null);
    const nextSuffix = rewardSuffix(nextReward);
    if (prevSuffix !== nextSuffix) {
      changes.push(nextReward === null ? `took the reward off it` : `set the reward to ${nextSuffix.replace(' for ', '')}`);
    }
  }

  logActivity(
    {
      actorId: actor.id,
      verb: 'task.updated',
      subjectType: 'task',
      subjectId: taskId,
      summary:
        changes.length > 0
          ? `${actor.name} edited "${title}" — ${changes.join(', ')}`
          : `${actor.name} edited "${title}"`,
    },
    now,
  );

  const notify: NotifyIntent[] = [];
  const url = `/?task=${taskId}`;
  if (reassigned && assignedTo !== null && assignedTo !== actor.id) {
    notify.push({
      audience: { kind: 'user', userId: assignedTo },
      title: input.isAsap ? 'ASAP — for you' : `${actor.name} assigned you a task`,
      body: title,
      url,
      tag: `task-${taskId}`,
      urgent: input.isAsap,
    });
  }
  // Only when it *becomes* ASAP — every later edit would otherwise re-alert everyone.
  if (input.isAsap && !existing.isAsap) {
    notify.push({
      audience: { kind: 'everyone', except: actor.id },
      title: 'ASAP',
      body: title,
      url,
      tag: `task-${taskId}`,
      urgent: true,
    });
  }

  return { ok: true, notify };
}

export function acceptTask(actor: User, taskId: number, now: number = Date.now()): MachineResult {
  const result = db
    .update(tasks)
    .set({ status: 'accepted', acceptedAt: now, updatedAt: now })
    .where(and(eq(tasks.id, taskId), eq(tasks.assignedTo, actor.id), eq(tasks.status, 'pending')))
    .run();

  if (result.changes === 0) return explainMiss(taskId);

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get()!;
  logActivity(
    {
      actorId: actor.id,
      verb: 'task.accepted',
      subjectType: 'task',
      subjectId: taskId,
      summary: `${actor.name} accepted "${task.title}"`,
    },
    now,
  );
  return { ok: true };
}

/**
 * Declining does not kill the task — it drops back into the open pool so someone
 * else can pick it up, which is why the status returns to 'pending' rather than
 * resting at 'declined'.
 */
export function declineTask(
  actor: User,
  taskId: number,
  reason: string,
  now: number = Date.now(),
): MachineResult {
  const trimmed = clean(reason, REASON_MAX) || null;
  const before = db.select().from(tasks).where(eq(tasks.id, taskId)).get();

  const result = db
    .update(tasks)
    .set({
      assignedTo: null,
      status: 'pending',
      acceptedAt: null,
      claimedAt: null,
      declineReason: trimmed,
      updatedAt: now,
    })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.assignedTo, actor.id),
        inArray(tasks.status, ['pending', 'accepted']),
      ),
    )
    .run();

  if (result.changes === 0) return explainMiss(taskId);

  logActivity(
    {
      actorId: actor.id,
      verb: 'task.declined',
      subjectType: 'task',
      subjectId: taskId,
      summary: trimmed
        ? `${actor.name} passed on "${before?.title ?? 'a task'}" — ${trimmed}`
        : `${actor.name} passed on "${before?.title ?? 'a task'}"`,
    },
    now,
  );

  const notify: NotifyIntent[] = [];
  if (before && before.createdBy !== actor.id) {
    notify.push({
      audience: { kind: 'user', userId: before.createdBy },
      title: `${actor.name} passed on your task`,
      body: trimmed ? `${before.title} — ${trimmed}` : `${before.title} — back up for grabs`,
      url: `/?task=${taskId}`,
      tag: `task-${taskId}`,
    });
  }
  return { ok: true, notify };
}

/**
 * The claim race. Two people tapping Claim in the same second must not both get
 * the task, so ownership is decided by one conditional UPDATE that only matches
 * while the task is still unowned — SQLite serialises the writes, so exactly one
 * of them reports a changed row. The loser changes nothing and is told who won.
 * Claiming *is* accepting, so this skips the pending step entirely.
 */
export function claimTask(actor: User, taskId: number, now: number = Date.now()): MachineResult {
  const result = db
    .update(tasks)
    .set({
      assignedTo: actor.id,
      status: 'accepted',
      claimedAt: now,
      acceptedAt: now,
      updatedAt: now,
    })
    .where(and(eq(tasks.id, taskId), isNull(tasks.assignedTo), eq(tasks.status, 'pending')))
    .run();

  if (result.changes === 0) return explainMiss(taskId);

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get()!;
  logActivity(
    {
      actorId: actor.id,
      verb: 'task.claimed',
      subjectType: 'task',
      subjectId: taskId,
      summary: `${actor.name} grabbed "${task.title}"`,
    },
    now,
  );
  return { ok: true };
}

/** Anyone can finish anything. No proof, no photo — the work is visible in the shop. */
export function completeTask(
  actor: User,
  taskId: number,
  now: number = Date.now(),
): MachineResult {
  const result = db
    .update(tasks)
    .set({ status: 'done', completedAt: now, completedBy: actor.id, updatedAt: now })
    .where(and(eq(tasks.id, taskId), inArray(tasks.status, ['pending', 'accepted'])))
    .run();

  if (result.changes === 0) return explainMiss(taskId);

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get()!;
  const owner =
    task.assignedTo !== null && task.assignedTo !== actor.id ? nameOf(task.assignedTo) : null;
  logActivity(
    {
      actorId: actor.id,
      verb: 'task.completed',
      subjectType: 'task',
      subjectId: taskId,
      summary: owner
        ? `${actor.name} finished "${task.title}" (${owner}'s task)`
        : `${actor.name} finished "${task.title}"`,
    },
    now,
  );
  return { ok: true };
}

/** The undo path out of Done Today, for the task someone ticked by mistake. */
export function reopenTask(actor: User, taskId: number, now: number = Date.now()): MachineResult {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return { ok: false, reason: 'gone' };

  // An owned task goes back to accepted; an unowned one returns to the pool.
  const restored = task.assignedTo === null ? 'pending' : 'accepted';

  const result = db
    .update(tasks)
    .set({ status: restored, completedAt: null, completedBy: null, updatedAt: now })
    .where(and(eq(tasks.id, taskId), eq(tasks.status, 'done')))
    .run();

  if (result.changes === 0) return explainMiss(taskId);

  logActivity(
    {
      actorId: actor.id,
      verb: 'task.reopened',
      subjectType: 'task',
      subjectId: taskId,
      summary: `${actor.name} put "${task.title}" back on the board`,
    },
    now,
  );
  return { ok: true };
}

/** Soft delete, by the creator or an admin. Tasks are never removed from the file. */
export function cancelTask(actor: User, taskId: number, now: number = Date.now()): MachineResult {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return { ok: false, reason: 'gone' };
  if (task.createdBy !== actor.id && !actor.isAdmin) {
    return {
      ok: false,
      reason: 'invalid',
      code: 'TASQ-E0210',
      message: `Only ${nameOf(task.createdBy)} or an admin can cancel that.`,
    };
  }

  const result = db
    .update(tasks)
    .set({ status: 'cancelled', updatedAt: now })
    .where(and(eq(tasks.id, taskId), inArray(tasks.status, ['pending', 'accepted'])))
    .run();

  if (result.changes === 0) return explainMiss(taskId);

  logActivity(
    {
      actorId: actor.id,
      verb: 'task.cancelled',
      subjectType: 'task',
      subjectId: taskId,
      summary: `${actor.name} cancelled "${task.title}"`,
    },
    now,
  );
  return { ok: true };
}
