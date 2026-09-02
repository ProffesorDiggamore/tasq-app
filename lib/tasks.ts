import 'server-only';
import { and, eq, gte, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '@/lib/db';
import { taskPhotos, tasks, users } from '@/lib/db/schema';
import { lastBoardResetAt } from '@/lib/time';
import type { BoardTask, BoardData } from '@/lib/board-types';

/** A task nobody has finished or cancelled is still the shop's problem. */
const OPEN_STATUSES = ['pending', 'accepted'] as const;

/**
 * Every row on the board is scoped to one tab. The shared "Tasqs" tab is the
 * absence of a group, so it has to be an IS NULL test rather than an equality
 * one — `group_id = NULL` matches nothing in SQL, which would silently empty
 * the default tab for every board that has never made a group.
 */
function inGroup(groupId: number | null) {
  return groupId === null ? isNull(tasks.groupId) : eq(tasks.groupId, groupId);
}

const creator = alias(users, 'creator');
const assignee = alias(users, 'assignee');
const completer = alias(users, 'completer');

const selection = {
  id: tasks.id,
  title: tasks.title,
  notes: tasks.notes,
  createdBy: tasks.createdBy,
  createdByName: creator.name,
  assignedTo: tasks.assignedTo,
  groupId: tasks.groupId,
  assignedToName: assignee.name,
  isAsap: tasks.isAsap,
  dueAt: tasks.dueAt,
  status: tasks.status,
  claimedAt: tasks.claimedAt,
  acceptedAt: tasks.acceptedAt,
  completedAt: tasks.completedAt,
  completedBy: tasks.completedBy,
  completedByName: completer.name,
  declineReason: tasks.declineReason,
  recurrenceId: tasks.recurrenceId,
  rewardCents: tasks.rewardCents,
  photoUpdatedAt: taskPhotos.updatedAt,
  createdAt: tasks.createdAt,
};

function baseQuery() {
  return db
    .select(selection)
    .from(tasks)
    .innerJoin(creator, eq(creator.id, tasks.createdBy))
    .leftJoin(assignee, eq(assignee.id, tasks.assignedTo))
    .leftJoin(completer, eq(completer.id, tasks.completedBy))
    // For photo presence only — never selects the blob columns.
    .leftJoin(taskPhotos, eq(taskPhotos.taskId, tasks.id));
}

type Row = ReturnType<typeof baseQuery> extends { all(): (infer R)[] } ? R : never;

function toBoardTask(row: Row): BoardTask {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    createdBy: row.createdBy,
    createdByName: row.createdByName,
    assignedTo: row.assignedTo,
    assignedToName: row.assignedToName,
    groupId: row.groupId,
    isAsap: row.isAsap,
    dueAt: row.dueAt,
    status: row.status,
    completedAt: row.completedAt,
    completedBy: row.completedBy,
    completedByName: row.completedByName,
    declineReason: row.declineReason,
    rewardCents: row.rewardCents,
    hasPhoto: row.photoUpdatedAt !== null,
    photoUpdatedAt: row.photoUpdatedAt,
    isRecurring: row.recurrenceId !== null,
    createdAt: row.createdAt,
  };
}

/**
 * Soonest first, but a task with no due time is not more urgent than one due in
 * an hour — undated work sorts to the back, then oldest-first so nothing rots
 * quietly at the end of a row.
 */
const byDueThenAge = sql`${tasks.dueAt} is null, ${tasks.dueAt} asc, ${tasks.createdAt} asc`;

/** Everything time-critical, shared by everyone, whoever it belongs to. */
export function asapTasks(groupId: number | null = null): BoardTask[] {
  return baseQuery()
    .where(
      and(inGroup(groupId), eq(tasks.isAsap, true), inArray(tasks.status, [...OPEN_STATUSES])),
    )
    .orderBy(byDueThenAge)
    .all()
    .map(toBoardTask);
}

/**
 * Yours, with anything still waiting on an Accept at the front — that is the
 * only thing on this row that needs a decision rather than work.
 */
export function myTasks(userId: number, groupId: number | null = null): BoardTask[] {
  return baseQuery()
    .where(
      and(inGroup(groupId), eq(tasks.assignedTo, userId), inArray(tasks.status, [...OPEN_STATUSES])),
    )
    .orderBy(sql`${tasks.status} = 'accepted', ${byDueThenAge}`)
    .all()
    .map(toBoardTask);
}

/** The open pool. First person to claim one wins. */
export function upForGrabs(groupId: number | null = null): BoardTask[] {
  return baseQuery()
    .where(and(inGroup(groupId), isNull(tasks.assignedTo), eq(tasks.status, 'pending')))
    .orderBy(byDueThenAge)
    .all()
    .map(toBoardTask);
}

/** Instances the scheduler spawned since the board last cleared. */
export function todaysRecurring(
  now: number = Date.now(),
  groupId: number | null = null,
): BoardTask[] {
  return baseQuery()
    .where(
      and(
        inGroup(groupId),
        isNotNull(tasks.recurrenceId),
        gte(tasks.createdAt, lastBoardResetAt(now)),
        inArray(tasks.status, ['pending', 'accepted', 'done']),
      ),
    )
    .orderBy(byDueThenAge)
    .all()
    .map(toBoardTask);
}

/**
 * Finished since the last 3am reset. These age off the board on their own — the
 * query moves on, nothing is deleted, and History keeps them forever.
 */
export function doneToday(now: number = Date.now(), groupId: number | null = null): BoardTask[] {
  return baseQuery()
    .where(
      and(
        inGroup(groupId),
        eq(tasks.status, 'done'),
        gte(tasks.completedAt, lastBoardResetAt(now)),
      ),
    )
    .orderBy(sql`${tasks.completedAt} desc`)
    .all()
    .map(toBoardTask);
}

export function getBoardTask(taskId: number): BoardTask | undefined {
  const row = baseQuery().where(eq(tasks.id, taskId)).get();
  return row ? toBoardTask(row) : undefined;
}

/** One pass over one tab of the board for the home screen. */
export function loadBoard(
  userId: number,
  now: number = Date.now(),
  groupId: number | null = null,
): BoardData {
  const asap = asapTasks(groupId);
  const mine = myTasks(userId, groupId);
  return {
    groupId,
    asap,
    mine,
    pool: upForGrabs(groupId),
    recurring: todaysRecurring(now, groupId),
    done: doneToday(now, groupId),
    // Badges have to work for anyone who declines notifications, so they count
    // the two things a person would otherwise only learn from a push.
    asapCount: asap.length,
    awaitingYou: mine.filter((t) => t.status === 'pending').length,
  };
}
