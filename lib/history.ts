import 'server-only';
import fs from 'node:fs';
import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { db, sqlite } from '@/lib/db';
import { activityLog, users } from '@/lib/db/schema';
import { DB_PATH } from '@/lib/paths';
import { localDateString, localWallClockToUtc, localWeekday } from '@/lib/time';
import type { HistoryDay, HistoryRange } from '@/lib/history-types';

export { isHistoryRange, verbTone } from '@/lib/history-types';
export type { HistoryDay, HistoryEntry, HistoryRange } from '@/lib/history-types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The start of the requested window, as a UTC instant on a shop-local day
 * boundary — so "today" means today in the shop, not wherever the phone is.
 */
export function rangeStart(range: HistoryRange, now: number = Date.now()): number | null {
  if (range === 'all') return null;
  const startOfToday = localWallClockToUtc(localDateString(now), '00:00');
  if (range === 'today') return startOfToday;
  if (range === 'month') return startOfToday - 29 * DAY_MS;
  // The week runs Monday to Sunday: a shop week, not a calendar convenience.
  const weekday = localWeekday(now);
  const sinceMonday = (weekday + 6) % 7;
  return localWallClockToUtc(localDateString(now - sinceMonday * DAY_MS), '00:00');
}

export interface HistoryQuery {
  range: HistoryRange;
  /** Null means everyone. */
  actorId: number | null;
  /** Free-text search across what happened and who did it. */
  text?: string;
  limit?: number;
}

export function loadHistory(
  query: HistoryQuery,
  now: number = Date.now(),
): { days: HistoryDay[]; total: number; truncated: boolean } {
  const limit = query.limit ?? 500;
  const filters: SQL[] = [];

  const from = rangeStart(query.range, now);
  if (from !== null) filters.push(gte(activityLog.createdAt, from));
  if (query.actorId !== null) filters.push(eq(activityLog.actorId, query.actorId));
  if (query.text) {
    const needle = `%${query.text.replace(/[%_]/g, (c) => `\\${c}`)}%`;
    // Summary covers what happened; the join covers who did it.
    filters.push(
      sql`(activity_log.summary LIKE ${needle} ESCAPE '\\' OR ${users.name} LIKE ${needle})`,
    );
  }

  const rows = db
    .select({
      id: activityLog.id,
      actorId: activityLog.actorId,
      actorName: users.name,
      verb: activityLog.verb,
      subjectType: activityLog.subjectType,
      subjectId: activityLog.subjectId,
      summary: activityLog.summary,
      createdAt: activityLog.createdAt,
    })
    .from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.actorId))
    .where(filters.length > 0 ? and(...filters) : undefined)
    // Reverse-chronological: the most recent thing that happened, first.
    .orderBy(desc(activityLog.createdAt))
    .limit(limit + 1)
    .all();

  const truncated = rows.length > limit;
  const visible = truncated ? rows.slice(0, limit) : rows;

  // Grouped by shop-local day so a week reads as a week, not a wall of rows.
  const days: HistoryDay[] = [];
  for (const entry of visible) {
    const date = localDateString(entry.createdAt);
    const last = days[days.length - 1];
    if (last && last.date === date) last.entries.push(entry);
    else days.push({ date, entries: [entry] });
  }

  return { days, total: visible.length, truncated };
}

/** Older than the retained window; used only to caption an empty result. */
export function hasAnyHistory(): boolean {
  return db.select({ id: activityLog.id }).from(activityLog).limit(1).all().length > 0;
}

// ---------------------------------------------------------------------------
// Retention. History is for "who did what recently", not forever: entries
// leave after a month on their own, and if the database ever grows past 1 GB
// anyway, the oldest quarter of the log is dropped to bring it back down.
// Both checks are cheap and gated to run at most once an hour.

const MONTH_MS = 30 * DAY_MS;
const STORAGE_CAP_BYTES = 1_000_000_000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;

let lastPruneAt = 0;

/** Test hook: open the hourly gate so a verify script can call prune twice. */
export function __resetPruneGateForTests(): void {
  lastPruneAt = 0;
}

export function pruneHistory(now: number = Date.now()): { removed: number; vacuumed: boolean } {
  if (now - lastPruneAt < PRUNE_EVERY_MS) return { removed: 0, vacuumed: false };
  lastPruneAt = now;

  const result = db
    .delete(activityLog)
    .where(lt(activityLog.createdAt, now - MONTH_MS))
    .run();
  let removed = result.changes;
  let vacuumed = false;

  if (fs.statSync(DB_PATH).size > STORAGE_CAP_BYTES) {
    // The cap tripped even with everything older than a month gone, so the
    // recent log alone is huge. Drop the oldest quarter. VACUUM only here:
    // it rewrites the whole database file, which is wasted work on the
    // routine monthly prune.
    const total = db.select({ n: sql<number>`count(*)` }).from(activityLog).get()?.n ?? 0;
    if (total > 0) {
      const drop = db
        .delete(activityLog)
        .where(
          sql`activity_log.id IN (SELECT id FROM activity_log ORDER BY created_at ASC LIMIT ${Math.ceil(total / 4)})`,
        )
        .run();
      removed += drop.changes;
      sqlite.exec('VACUUM');
      vacuumed = true;
      console.log(
        `[tasq] history exceeded the 1 GB storage cap — dropped the oldest ${drop.changes} entr${drop.changes === 1 ? 'y' : 'ies'} and compacted.`,
      );
    }
  }

  if (removed > 0 && !vacuumed) {
    console.log(`[tasq] pruned ${removed} history entr${removed === 1 ? 'y' : 'ies'} older than a month.`);
  }
  return { removed, vacuumed };
}

