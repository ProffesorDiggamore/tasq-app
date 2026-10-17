import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tasks, users, type User } from '@/lib/db/schema';
import { canUseGroup } from '@/lib/groups';
import { logActivity } from '@/lib/activity';
import { localWallClockToUtc } from '@/lib/time';
import type { NewTaskInput, NotifyIntent, TaskActionResult } from '@/lib/board-types';
import { money } from '@/lib/money';
import {
  ASAP_FOR_YOU_HEADLINE,
  NOTIFY_HEADLINE,
  notifyBody,
  personDetail,
  taskDetail,
} from '@/lib/notify-copy';

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

async function nameOf(userId: number): Promise<string> {
  return (
    (await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).get())?.name ?? 'Someone'
  );
}

async function explainMiss(taskId: number): Promise<TaskActionResult & { code?: string }> {
  const task = await db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return { ok: false, reason: 'gone', code: 'TASQ-E0201' };

  if (task.status === 'cancelled') {
    return { ok: false, reason: 'stale', code: 'TASQ-E0202', message: 'That tasq was cancelled.' };
  }
  if (task.status === 'done') {
    const by = task.completedBy ? await nameOf(task.completedBy) : null;
    return {
      ok: false,
      reason: 'stale',
      code: 'TASQ-E0203',
      message: by ? `${by} already finished that one.` : 'That tasq is already done.',
    };
  }
  if (task.assignedTo !== null) {
    return { ok: false, reason: 'claimed', code: 'TASQ-E0204', by: await nameOf(task.assignedTo) };
  }
  return { ok: false, reason: 'stale', code: 'TASQ-E0211', message: 'That tasq moved — pull down to refresh.' };
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
  return cents ? ` for ${money(cents)}` : '';
}

export async function createTask(
  actor: User,
  input: NewTaskInput,
  now: number = Date.now(),
): Promise<MachineResult & { taskId?: number }> {
  // Anyone on the board can post work — to the shared Tasqs tab, or to a tab
  // they are in. What stays the owner's alone is money: a bounty is spending,
  // so a non-admin's reward is dropped rather than the whole task refused.
  const groupId = input.groupId ?? null;
  if (!await canUseGroup(actor, groupId)) {
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
    const target = await db
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

  const created = await db
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

  await logActivity(
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
          : `${actor.name} assigned "${title}" to ${await nameOf(assignedTo)}${rewardSuffix(
              rewardCents,
            )}${input.isAsap ? ' (ASAP)' : ''}`,
    },
    now,
  );

  const notify: NotifyIntent[] = [];
  const url = `/?task=${created.id}`;
  if (assignedTo !== null) {
    // Assigning yourself buzzes too, under its own rule: someone standing at the
    // board adding six jobs to their own list wants the same receipt on their
    // phone that everybody else gets, and an admin who never sees one has no way
    // to tell a working notification from a broken one.
    const mine = assignedTo === actor.id;
    const event = mine ? 'task.self-assigned' : 'task.assigned';
    notify.push({
      audience: { kind: 'user', userId: assignedTo },
      title: input.isAsap ? ASAP_FOR_YOU_HEADLINE : NOTIFY_HEADLINE[event],
      body: notifyBody(title, taskDetail({ rewardCents, dueAt, notes })),
      url,
      tag: `task-${created.id}`,
      urgent: input.isAsap,
      event,
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
      title: NOTIFY_HEADLINE['task.asap'],
      body: notifyBody(title, taskDetail({ rewardCents, dueAt, notes })),
      url,
      tag: `task-${created.id}`,
      urgent: true,
      event: 'task.asap',
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
export async function updateTask(
  actor: User,
  taskId: number,
  input: NewTaskInput,
  now: number = Date.now(),
): Promise<MachineResult> {
  const existing = await db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!existing) return { ok: false, reason: 'gone' };
  if (existing.createdBy !== actor.id && !actor.isAdmin) {
    return {
      ok: false,
      reason: 'invalid',
      code: 'TASQ-E0209',
      message: `Only ${await nameOf(existing.createdBy)} or an admin can edit that.`,
    };
  }
  if (existing.status === 'done' || existing.status === 'cancelled') {
    return {
      ok: false,
      reason: 'stale',
      code: existing.status === 'done' ? 'TASQ-E0203' : 'TASQ-E0202',
      message: `That tasq is already ${existing.status}. Put it back first.`,
    };
  }

  const title = clean(input.title, TITLE_MAX);
  if (title.length === 0) return { ok: false, reason: 'invalid', code: 'TASQ-E0206', message: 'Give it a title.' };
  const notes = clean(input.notes, NOTES_MAX) || null;

  let assignedTo: number | null = null;
  if (input.assignedTo !== null) {
    const target = await db
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

  const result = await db
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
  if (result.rowsAffected === 0) return await explainMiss(taskId);

  const changes: string[] = [];
  if (title !== existing.title) changes.push(`renamed it from "${existing.title}"`);
  if (reassigned) {
    changes.push(assignedTo === null ? 'put it up for grabs' : `gave it to ${await nameOf(assignedTo)}`);
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

  await logActivity(
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
  if (reassigned && assignedTo !== null) {
    const mine = assignedTo === actor.id;
    const event = mine ? 'task.self-assigned' : 'task.assigned';
    notify.push({
      audience: { kind: 'user', userId: assignedTo },
      title: input.isAsap ? ASAP_FOR_YOU_HEADLINE : NOTIFY_HEADLINE[event],
      body: notifyBody(title, taskDetail({ rewardCents, dueAt, notes })),
      url,
      tag: `task-${taskId}`,
      urgent: input.isAsap,
      event,
    });
  }
  // Only when it *becomes* ASAP — every later edit would otherwise re-alert everyone.
  // Same audience rule as createTask: on a group tab, only that tab hears it.
  if (input.isAsap && !existing.isAsap) {
    notify.push({
      audience:
        existing.groupId === null
          ? { kind: 'everyone', except: actor.id }
          : { kind: 'group', groupId: existing.groupId, except: actor.id },
      title: NOTIFY_HEADLINE['task.asap'],
      body: notifyBody(title, taskDetail({ rewardCents, dueAt, notes })),
      url,
      tag: `task-${taskId}`,
      urgent: true,
      event: 'task.asap',
    });
  }

  return { ok: true, notify };
}

export async function acceptTask(actor: User, taskId: number, now: number = Date.now()): Promise<MachineResult> {
  const result = await db
    .update(tasks)
    .set({ status: 'accepted', acceptedAt: now, updatedAt: now })
    .where(and(eq(tasks.id, taskId), eq(tasks.assignedTo, actor.id), eq(tasks.status, 'pending')))
    .run();

  if (result.rowsAffected === 0) return await explainMiss(taskId);

  const task = (await db.select().from(tasks).where(eq(tasks.id, taskId)).get())!;
  await logActivity(
    {
      actorId: actor.id,
      verb: 'task.accepted',
      subjectType: 'task',
      subjectId: taskId,
      summary: `${actor.name} accepted "${task.title}"`,
    },
    now,
  );
  return {
    ok: true,
    notify: [
      {
        // Whoever runs the board is the one who needs to know the work was
        // picked up; the crew can see it on the board itself.
        audience: { kind: 'admins', except: actor.id },
        title: NOTIFY_HEADLINE['task.accepted'],
        body: notifyBody(task.title, personDetail(actor.name, task.rewardCents)),
        url: `/?task=${taskId}`,
        tag: `task-${taskId}`,
        event: 'task.accepted',
      },
    ],
  };
}

/**
 * Declining does not kill the task — it drops back into the open pool so someone
 * else can pick it up, which is why the status returns to 'pending' rather than
 * resting at 'declined'.
 */
export async function declineTask(
  actor: User,
  taskId: number,
  reason: string,
  now: number = Date.now(),
): Promise<MachineResult> {
  const trimmed = clean(reason, REASON_MAX) || null;
  const before = await db.select().from(tasks).where(eq(tasks.id, taskId)).get();

  const result = await db
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

  if (result.rowsAffected === 0) return await explainMiss(taskId);

  await logActivity(
    {
      actorId: actor.id,
      verb: 'task.declined',
      subjectType: 'task',
      subjectId: taskId,
      summary: trimmed
        ? `${actor.name} passed on "${before?.title ?? 'a tasq'}" — ${trimmed}`
        : `${actor.name} passed on "${before?.title ?? 'a tasq'}"`,
    },
    now,
  );

  const notify: NotifyIntent[] = [];
  if (before && before.createdBy !== actor.id) {
    notify.push({
      audience: { kind: 'user', userId: before.createdBy },
      title: NOTIFY_HEADLINE['task.declined'],
      body: notifyBody(before.title, trimmed ? `${actor.name}: ${trimmed}` : `${actor.name} passed — back up for grabs`),
      url: `/?task=${taskId}`,
      tag: `task-${taskId}`,
      event: 'task.declined',
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
export async function claimTask(actor: User, taskId: number, now: number = Date.now()): Promise<MachineResult> {
  const result = await db
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

  if (result.rowsAffected === 0) return await explainMiss(taskId);

  const task = (await db.select().from(tasks).where(eq(tasks.id, taskId)).get())!;
  await logActivity(
    {
      actorId: actor.id,
      verb: 'task.claimed',
      subjectType: 'task',
      subjectId: taskId,
      summary: `${actor.name} grabbed "${task.title}"`,
    },
    now,
  );
  return {
    ok: true,
    notify: [
      {
        audience: { kind: 'admins', except: actor.id },
        title: NOTIFY_HEADLINE['task.claimed'],
        body: notifyBody(task.title, personDetail(actor.name, task.rewardCents)),
        url: `/?task=${taskId}`,
        tag: `task-${taskId}`,
        event: 'task.claimed',
      },
    ],
  };
}

/** Anyone can finish anything. No proof, no photo — the work is visible in the shop. */
export async function completeTask(
  actor: User,
  taskId: number,
  now: number = Date.now(),
): Promise<MachineResult> {
  const result = await db
    .update(tasks)
    .set({ status: 'done', completedAt: now, completedBy: actor.id, updatedAt: now })
    .where(and(eq(tasks.id, taskId), inArray(tasks.status, ['pending', 'accepted'])))
    .run();

  if (result.rowsAffected === 0) return await explainMiss(taskId);

  const task = (await db.select().from(tasks).where(eq(tasks.id, taskId)).get())!;
  const owner =
    task.assignedTo !== null && task.assignedTo !== actor.id ? await nameOf(task.assignedTo) : null;
  await logActivity(
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
  return {
    ok: true,
    notify: [
      {
        // What the board pays out is the admin's business, so the amount goes in
        // the title where a phone shows it without being unlocked.
        audience: { kind: 'admins', except: actor.id },
        title: NOTIFY_HEADLINE['task.completed'],
        body: notifyBody(
          owner ? `${task.title} (${owner}'s)` : task.title,
          personDetail(actor.name, task.rewardCents),
        ),
        url: `/?task=${taskId}`,
        tag: `task-${taskId}`,
        event: 'task.completed',
      },
    ],
  };
}

/** The undo path out of Done Today, for the task someone ticked by mistake. */
export async function reopenTask(actor: User, taskId: number, now: number = Date.now()): Promise<MachineResult> {
  const task = await db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return { ok: false, reason: 'gone' };

  // An owned task goes back to accepted; an unowned one returns to the pool.
  const restored = task.assignedTo === null ? 'pending' : 'accepted';

  const result = await db
    .update(tasks)
    .set({ status: restored, completedAt: null, completedBy: null, updatedAt: now })
    .where(and(eq(tasks.id, taskId), eq(tasks.status, 'done')))
    .run();

  if (result.rowsAffected === 0) return await explainMiss(taskId);

  await logActivity(
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
export async function cancelTask(actor: User, taskId: number, now: number = Date.now()): Promise<MachineResult> {
  const task = await db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return { ok: false, reason: 'gone' };
  if (task.createdBy !== actor.id && !actor.isAdmin) {
    return {
      ok: false,
      reason: 'invalid',
      code: 'TASQ-E0210',
      message: `Only ${await nameOf(task.createdBy)} or an admin can cancel that.`,
    };
  }

  const result = await db
    .update(tasks)
    .set({ status: 'cancelled', updatedAt: now })
    .where(and(eq(tasks.id, taskId), inArray(tasks.status, ['pending', 'accepted'])))
    .run();

  if (result.rowsAffected === 0) return await explainMiss(taskId);

  await logActivity(
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
