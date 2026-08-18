import 'server-only';
import { and, eq, gte, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '@/lib/db';
import { tasks, users } from '@/lib/db/schema';
import { lastBoardResetAt } from '@/lib/time';
import type { BoardTask, BoardData } from '@/lib/board-types';

/** A task nobody has finished or cancelled is still the shop's problem. */
const OPEN_STATUSES = ['pending', 'accepted'] as const;

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
  createdAt: tasks.createdAt,
};

function baseQuery() {
  return db
    .select(selection)
    .from(tasks)
    .innerJoin(creator, eq(creator.id, tasks.createdBy))
    .leftJoin(assignee, eq(assignee.id, tasks.assignedTo))
    .leftJoin(completer, eq(completer.id, tasks.completedBy));
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
    isAsap: row.isAsap,
    dueAt: row.dueAt,
    status: row.status,
    completedAt: row.completedAt,
    completedBy: row.completedBy,
    completedByName: row.completedByName,
    declineReason: row.declineReason,
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
export function asapTasks(): BoardTask[] {
  return baseQuery()
    .where(and(eq(tasks.isAsap, true), inArray(tasks.status, [...OPEN_STATUSES])))
    .orderBy(byDueThenAge)
    .all()
    .map(toBoardTask);
}

/**
 * Yours, with anything still waiting on an Accept at the front — that is the
 * only thing on this row that needs a decision rather than work.
 */
export function myTasks(userId: number): BoardTask[] {
  return baseQuery()
    .where(and(eq(tasks.assignedTo, userId), inArray(tasks.status, [...OPEN_STATUSES])))
    .orderBy(sql`${tasks.status} = 'accepted', ${byDueThenAge}`)
    .all()
    .map(toBoardTask);
}

/** The open pool. First person to claim one wins. */
export function upForGrabs(): BoardTask[] {
  return baseQuery()
    .where(and(isNull(tasks.assignedTo), eq(tasks.status, 'pending')))
    .orderBy(byDueThenAge)
    .all()
    .map(toBoardTask);
}

/** Instances the scheduler spawned since the board last cleared. */
export function todaysRecurring(now: number = Date.now()): BoardTask[] {
  return baseQuery()
    .where(
      and(
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
export function doneToday(now: number = Date.now()): BoardTask[] {
  return baseQuery()
    .where(and(eq(tasks.status, 'done'), gte(tasks.completedAt, lastBoardResetAt(now))))
    .orderBy(sql`${tasks.completedAt} desc`)
    .all()
    .map(toBoardTask);
}

export function getBoardTask(taskId: number): BoardTask | undefined {
  const row = baseQuery().where(eq(tasks.id, taskId)).get();
  return row ? toBoardTask(row) : undefined;
}

/** One pass over the board for the home screen. */
export function loadBoard(userId: number, now: number = Date.now()): BoardData {
  const asap = asapTasks();
  const mine = myTasks(userId);
  return {
    asap,
    mine,
    pool: upForGrabs(),
    recurring: todaysRecurring(now),
    done: doneToday(now),
    // Badges have to work for anyone who declines notifications, so they count
    // the two things a person would otherwise only learn from a push.
    asapCount: asap.length,
    awaitingYou: mine.filter((t) => t.status === 'pending').length,
  };
}
