import 'server-only';
import { and, asc, eq, isNull, ne, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { recurrences, tasks, users, type Recurrence, type User } from '@/lib/db/schema';
import { logActivity } from '@/lib/activity';
import {
  localClockString,
  localDateString,
  localDayOfMonth,
  localWeekday,
} from '@/lib/time';
import type { RecurrenceInput, RecurrenceSummary } from '@/lib/board-types';
import { fail, ok, type ActionResult } from '@/lib/action-result';

const TITLE_MAX = 120;
const NOTES_MAX = 4000;

export function parseWeekdays(csv: string | null): number[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Does this rule land on the shop-local date of `now`?
 *
 * Monthly rules clamp: "the 31st" in a 30-day month fires on the 30th rather
 * than skipping the month entirely, which is what someone setting a rent
 * reminder actually means.
 */
export function isDueOn(rec: Recurrence, now: number): boolean {
  switch (rec.pattern) {
    case 'daily':
      return true;
    case 'weekly':
      return parseWeekdays(rec.weekdays).includes(localWeekday(now));
    case 'monthly': {
      if (rec.dayOfMonth === null) return false;
      const date = localDateString(now);
      const year = Number(date.slice(0, 4));
      const monthIndex = Number(date.slice(5, 7)) - 1;
      const today = localDayOfMonth(now);
      const target = Math.min(rec.dayOfMonth, daysInMonth(year, monthIndex));
      return today === target;
    }
  }
}

/** Has the local wall clock reached this rule's spawn time today? */
function spawnTimeReached(rec: Recurrence, now: number): boolean {
  return localClockString(now) >= rec.spawnTime;
}

export interface SpawnReport {
  spawned: number;
  titles: string[];
}

/**
 * Spawn every rule that is due today and has not already fired today.
 *
 * The idempotency guard is the conditional UPDATE on `last_spawned_on`: the day
 * is *claimed* before the task is inserted, and the claim only matches while the
 * column still holds something other than today's local date. Two ticks landing
 * together, a boot that races the interval, or a machine waking from sleep and
 * running catch-up all funnel through the same claim, so a rule can spawn at
 * most once per local day no matter how often this runs.
 *
 * Catch-up is the same code path: a rule whose spawn time passed while the Mac
 * was asleep still has yesterday's date in the column, so the next tick fires it.
 * Missed *days* are deliberately not backfilled — nobody wants Monday's greasing
 * to appear four times because the machine was off all week.
 */
export function spawnDueRecurrences(now: number = Date.now()): SpawnReport {
  const today = localDateString(now);
  const candidates = db
    .select()
    .from(recurrences)
    .where(
      and(
        eq(recurrences.active, true),
        isNull(recurrences.archivedAt),
        or(isNull(recurrences.lastSpawnedOn), ne(recurrences.lastSpawnedOn, today)),
      ),
    )
    .all();

  const report: SpawnReport = { spawned: 0, titles: [] };

  for (const rec of candidates) {
    if (!isDueOn(rec, now)) continue;
    if (!spawnTimeReached(rec, now)) continue;

    const claimed = db
      .update(recurrences)
      .set({ lastSpawnedOn: today })
      .where(
        and(
          eq(recurrences.id, rec.id),
          or(isNull(recurrences.lastSpawnedOn), ne(recurrences.lastSpawnedOn, today)),
        ),
      )
      .run();
    // Someone else claimed today for this rule between the select and here.
    if (claimed.changes === 0) continue;

    // An assignee who has since been archived falls back to the open pool
    // rather than spawning a task nobody can see.
    let assignedTo: number | null = null;
    if (rec.defaultAssignee !== null) {
      const person = db
        .select()
        .from(users)
        .where(and(eq(users.id, rec.defaultAssignee), isNull(users.archivedAt)))
        .get();
      assignedTo = person ? person.id : null;
    }

    const inserted = db
      .insert(tasks)
      .values({
        title: rec.title,
        notes: rec.notes,
        createdBy: rec.createdBy,
        assignedTo,
        isAsap: rec.isAsap,
        status: 'pending',
        recurrenceId: rec.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: tasks.id })
      .get();

    logActivity(
      {
        // No actor: the scheduler did this, not a person.
        actorId: null,
        verb: assignedTo === null ? 'task.created' : 'task.assigned',
        subjectType: 'task',
        subjectId: inserted.id,
        summary:
          assignedTo === null
            ? `Repeating task "${rec.title}" went up for grabs`
            : `Repeating task "${rec.title}" went to ${nameOf(assignedTo)}`,
      },
      now,
    );

    report.spawned += 1;
    report.titles.push(rec.title);
  }

  return report;
}

function nameOf(userId: number): string {
  return (
    db.select({ name: users.name }).from(users).where(eq(users.id, userId)).get()?.name ?? 'Someone'
  );
}

function cleanText(value: string, max: number): string {
  return value.trim().slice(0, max);
}

export function validateRecurrence(input: RecurrenceInput): string | null {
  if (cleanText(input.title, TITLE_MAX).length === 0) return 'Give it a title.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.spawnTime)) return 'Pick a time of day.';
  if (input.pattern === 'weekly' && input.weekdays.length === 0) {
    return 'Pick at least one day of the week.';
  }
  if (
    input.pattern === 'monthly' &&
    (input.dayOfMonth === null || input.dayOfMonth < 1 || input.dayOfMonth > 31)
  ) {
    return 'Pick a day of the month.';
  }
  return null;
}

export function createRecurrence(
  actor: User,
  input: RecurrenceInput,
  now: number = Date.now(),
): ActionResult & { recurrenceId?: number } {
  const problem = validateRecurrence(input);
  if (problem) return fail(problem);

  if (input.defaultAssignee !== null) {
    const person = db
      .select()
      .from(users)
      .where(and(eq(users.id, input.defaultAssignee), isNull(users.archivedAt)))
      .get();
    if (!person) return fail('That person is no longer on the board.');
  }

  const created = db
    .insert(recurrences)
    .values({
      title: cleanText(input.title, TITLE_MAX),
      notes: cleanText(input.notes, NOTES_MAX) || null,
      createdBy: actor.id,
      defaultAssignee: input.defaultAssignee,
      isAsap: input.isAsap,
      pattern: input.pattern,
      weekdays: input.pattern === 'weekly' ? input.weekdays.sort().join(',') : null,
      dayOfMonth: input.pattern === 'monthly' ? input.dayOfMonth : null,
      spawnTime: input.spawnTime,
      active: true,
      createdAt: now,
      lastSpawnedOn: null,
    })
    .returning({ id: recurrences.id })
    .get();

  logActivity(
    {
      actorId: actor.id,
      verb: 'recurrence.created',
      subjectType: 'recurrence',
      subjectId: created.id,
      summary: `${actor.name} set "${input.title.trim()}" to repeat ${describeSchedule(
        input.pattern,
        input.weekdays,
        input.dayOfMonth,
        input.spawnTime,
      )}`,
    },
    now,
  );

  return { ...ok, recurrenceId: created.id };
}

/**
 * Edit a rule in place. The instances it already spawned are left alone — they
 * are somebody's work in progress, and silently retitling a task on the board
 * because a schedule changed would be worse than leaving it.
 */
export function updateRecurrence(
  actor: User,
  recurrenceId: number,
  input: RecurrenceInput,
  now: number = Date.now(),
): ActionResult {
  const existing = db
    .select()
    .from(recurrences)
    .where(and(eq(recurrences.id, recurrenceId), isNull(recurrences.archivedAt)))
    .get();
  if (!existing) return fail('That repeating task is gone.');

  const problem = validateRecurrence(input);
  if (problem) return fail(problem);

  if (input.defaultAssignee !== null) {
    const person = db
      .select()
      .from(users)
      .where(and(eq(users.id, input.defaultAssignee), isNull(users.archivedAt)))
      .get();
    if (!person) return fail('That person is no longer on the board.');
  }

  const title = cleanText(input.title, TITLE_MAX);
  const nextSchedule = describeSchedule(
    input.pattern,
    input.weekdays,
    input.dayOfMonth,
    input.spawnTime,
  );
  const wasSchedule = describeSchedule(
    existing.pattern,
    parseWeekdays(existing.weekdays),
    existing.dayOfMonth,
    existing.spawnTime,
  );

  db.update(recurrences)
    .set({
      title,
      notes: cleanText(input.notes, NOTES_MAX) || null,
      defaultAssignee: input.defaultAssignee,
      isAsap: input.isAsap,
      pattern: input.pattern,
      weekdays: input.pattern === 'weekly' ? [...input.weekdays].sort().join(',') : null,
      dayOfMonth: input.pattern === 'monthly' ? input.dayOfMonth : null,
      spawnTime: input.spawnTime,
    })
    .where(eq(recurrences.id, recurrenceId))
    .run();

  // Say what actually changed, so History is worth reading.
  const changes: string[] = [];
  if (title !== existing.title) changes.push(`renamed it from "${existing.title}"`);
  if (nextSchedule !== wasSchedule) changes.push(`moved it to ${nextSchedule}`);
  if (input.defaultAssignee !== existing.defaultAssignee) {
    changes.push(
      input.defaultAssignee === null
        ? 'put it up for grabs'
        : `gave it to ${nameOf(input.defaultAssignee)}`,
    );
  }
  if (input.isAsap !== existing.isAsap) {
    changes.push(input.isAsap ? 'marked it ASAP' : 'took ASAP off it');
  }

  logActivity(
    {
      actorId: actor.id,
      verb: 'recurrence.updated',
      subjectType: 'recurrence',
      subjectId: recurrenceId,
      summary:
        changes.length > 0
          ? `${actor.name} edited the repeating task "${title}" — ${changes.join(', ')}`
          : `${actor.name} edited the repeating task "${title}"`,
    },
    now,
  );

  return ok;
}

/**
 * Soft delete. The rule leaves the list and stops spawning; the tasks it already
 * created keep pointing at it, so nothing on the board or in History breaks.
 */
export function deleteRecurrence(
  actor: User,
  recurrenceId: number,
  now: number = Date.now(),
): ActionResult {
  const existing = db
    .select()
    .from(recurrences)
    .where(and(eq(recurrences.id, recurrenceId), isNull(recurrences.archivedAt)))
    .get();
  if (!existing) return fail('That repeating task is gone.');

  db.update(recurrences)
    .set({ archivedAt: now, active: false })
    .where(eq(recurrences.id, recurrenceId))
    .run();

  logActivity(
    {
      actorId: actor.id,
      verb: 'recurrence.deleted',
      subjectType: 'recurrence',
      subjectId: recurrenceId,
      summary: `${actor.name} deleted the repeating task "${existing.title}"`,
    },
    now,
  );
  return ok;
}

export function setRecurrenceActive(
  actor: User,
  recurrenceId: number,
  active: boolean,
  now: number = Date.now(),
): ActionResult {
  const rec = db.select().from(recurrences).where(eq(recurrences.id, recurrenceId)).get();
  if (!rec) return fail('That repeating task is gone.');

  db.update(recurrences).set({ active }).where(eq(recurrences.id, recurrenceId)).run();
  logActivity(
    {
      actorId: actor.id,
      verb: active ? 'recurrence.resumed' : 'recurrence.paused',
      subjectType: 'recurrence',
      subjectId: recurrenceId,
      summary: `${actor.name} ${active ? 'resumed' : 'paused'} the repeating task "${rec.title}"`,
    },
    now,
  );
  return ok;
}

/** "every day at 6:00am", "Mondays at 7:00am", "on the 1st at 9:00am". */
export function describeSchedule(
  pattern: RecurrenceInput['pattern'],
  weekdays: number[],
  dayOfMonth: number | null,
  spawnTime: string,
): string {
  const at = ` at ${friendlyTime(spawnTime)}`;
  if (pattern === 'daily') return `every day${at}`;
  if (pattern === 'weekly') {
    const names = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
    const picked = [...weekdays].sort().map((d) => names[d]);
    if (picked.length === 7) return `every day${at}`;
    if (picked.length === 0) return `weekly${at}`;
    if (picked.length === 1) return `${picked[0]}${at}`;
    return `${picked.slice(0, -1).join(', ')} and ${picked[picked.length - 1]}${at}`;
  }
  return `on the ${ordinal(dayOfMonth ?? 1)} of the month${at}`;
}

function friendlyTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function listRecurrences(): RecurrenceSummary[] {
  return db
    .select({
      id: recurrences.id,
      title: recurrences.title,
      pattern: recurrences.pattern,
      notes: recurrences.notes,
      weekdays: recurrences.weekdays,
      dayOfMonth: recurrences.dayOfMonth,
      spawnTime: recurrences.spawnTime,
      active: recurrences.active,
      defaultAssignee: recurrences.defaultAssignee,
      assigneeName: users.name,
      isAsap: recurrences.isAsap,
      lastSpawnedOn: recurrences.lastSpawnedOn,
    })
    .from(recurrences)
    .leftJoin(users, eq(users.id, recurrences.defaultAssignee))
    .where(isNull(recurrences.archivedAt))
    .orderBy(asc(recurrences.title))
    .all()
    .map((r) => ({
      ...r,
      schedule: describeSchedule(r.pattern, parseWeekdays(r.weekdays), r.dayOfMonth, r.spawnTime),
    }));
}
