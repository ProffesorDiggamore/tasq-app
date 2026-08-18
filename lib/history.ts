import 'server-only';
import { and, desc, eq, gte, lt, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { activityLog, users } from '@/lib/db/schema';
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

