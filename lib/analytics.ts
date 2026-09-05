import 'server-only';
import { and, eq, gt, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  devices,
  supplyRequests,
  tasks,
  users,
  type User,
} from '@/lib/db/schema';
import { groupIdsForUser } from '@/lib/groups';
import { localDateString } from '@/lib/time';
import type {
  AdminAnalytics,
  AnalyticsPayload,
  CrewRow,
  DayPoint,
  PersonalAnalytics,
  RangeCounts,
  ShopAnalytics,
} from '@/lib/analytics-types';

/**
 * The numbers behind the Analytics screen.
 *
 * Two rules shape this file.
 *
 * The first is that nothing here is stored. Every figure is derived from the
 * tasks table on read, exactly as the Payouts screen derives what is owed, so
 * there is no counter to drift out of step with the board and no migration
 * needed to start counting. A shop's whole history is a few thousand rows on a
 * local SQLite file — this is a handful of indexed scans, not a warehouse.
 *
 * The second is that the tier is decided *here*, not in the markup. A crew
 * member's payload is built without the shop's money, without anybody else's
 * earnings, and without a name-by-name ranking, so the screen has nothing
 * sensitive to conditionally hide and the response itself is safe to read.
 * What a crew member does get is everything about their own work, plus shop
 * totals for the tabs they are actually on — enough to feel the week add up.
 */

const DAY_MS = 86_400_000;
/** The longest window the screen offers, and therefore the only one queried. */
const WINDOW_DAYS = 90;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * The last `count` shop-local dates, oldest first.
 *
 * Anchored at noon UTC and stepped a day at a time so a spring-forward or
 * fall-back never produces a duplicated or missing bucket — stepping by 24h
 * from midnight does exactly that twice a year.
 */
export function dayKeys(now: number, count: number): string[] {
  const [y, m, d] = localDateString(now).split('-').map(Number);
  const anchor = Date.UTC(y, m - 1, d, 12);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const dt = new Date(anchor - i * DAY_MS);
    out.push(
      `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`,
    );
  }
  return out;
}

/** A dense series — every day in the window, including the empty ones. */
function seriesFrom(keys: string[], counts: Map<string, number>): DayPoint[] {
  return keys.map((date) => ({ date, count: counts.get(date) ?? 0 }));
}

/**
 * Totals over each window, plus the window before it.
 *
 * The trailing pair is what makes a number mean something: "34 this month" is
 * a fact, "34, up from 21" is a result. The `all` figure comes in separately
 * because it reaches back past the 90 days this file loads.
 */
function rangeCounts(series: DayPoint[], all: number): RangeCounts {
  const total = (from: number, to: number) =>
    series.slice(from, to).reduce((sum, p) => sum + p.count, 0);
  const n = series.length;
  return {
    d7: total(n - 7, n),
    d30: total(n - 30, n),
    d90: total(0, n),
    // The 90-day window cannot see 90 days before itself, so its comparison is
    // the only one that stays at zero. 7 and 30 both have room behind them.
    prev7: total(n - 14, n - 7),
    prev30: total(n - 60, n - 30),
    prev90: 0,
    all,
  };
}

/** Consecutive days ending today — or ending yesterday, if today is still young. */
function streakFrom(series: DayPoint[]): number {
  let i = series.length - 1;
  // A streak should not break at breakfast. Nothing done yet today counts back
  // from yesterday; a day that ends with nothing done is what breaks it.
  if (i >= 0 && series[i].count === 0) i -= 1;
  let streak = 0;
  for (; i >= 0 && series[i].count > 0; i -= 1) streak += 1;
  return streak;
}

/** The longest run anywhere in the window. */
function bestStreakFrom(series: DayPoint[]): number {
  let best = 0;
  let run = 0;
  for (const point of series) {
    run = point.count > 0 ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Which tasks this reader is allowed to be counted over.
 *
 * An admin runs every tab, so it is everything. Everyone else sees the shared
 * Tasqs tab plus the tabs they were put in — the same rule the board itself
 * uses, applied to the totals so a crew member's "shop this week" never counts
 * work on a tab they cannot open.
 */
function visibilityFilter(user: User) {
  if (user.isAdmin) return undefined;
  const mine = groupIdsForUser(user.id);
  return mine.length === 0
    ? isNull(tasks.groupId)
    : or(isNull(tasks.groupId), inArray(tasks.groupId, mine));
}

/** One finished task, reduced to the columns every figure below is built from. */
interface DoneRow {
  completedAt: number;
  completedBy: number | null;
  createdAt: number;
  dueAt: number | null;
  claimedAt: number | null;
  isAsap: boolean;
  rewardCents: number | null;
  recurrenceId: number | null;
}

export function analyticsFor(user: User, now: number = Date.now()): AnalyticsPayload {
  const keys = dayKeys(now, WINDOW_DAYS);
  // One day of slack on the low side: the window's first local day starts
  // before its UTC midnight in a western zone.
  const windowStart = now - (WINDOW_DAYS + 1) * DAY_MS;
  const scope = visibilityFilter(user);

  const doneRows = db
    .select({
      completedAt: tasks.completedAt,
      completedBy: tasks.completedBy,
      createdAt: tasks.createdAt,
      dueAt: tasks.dueAt,
      claimedAt: tasks.claimedAt,
      isAsap: tasks.isAsap,
      rewardCents: tasks.rewardCents,
      recurrenceId: tasks.recurrenceId,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.status, 'done'),
        isNotNull(tasks.completedAt),
        gte(tasks.completedAt, windowStart),
        scope,
      ),
    )
    .all()
    .filter((r): r is DoneRow => r.completedAt !== null);

  const personal = personalAnalytics(user, doneRows, keys, scope);
  const shop = shopAnalytics(doneRows, keys, scope, now);
  // Their slice of the shop's month — the one comparison that motivates without
  // ranking anybody against anybody.
  personal.sharePct =
    shop.done.d30 > 0 ? Math.round((personal.done.d30 / shop.done.d30) * 100) : 0;

  return {
    isAdmin: user.isAdmin,
    viewerId: user.id,
    viewerName: user.name,
    now,
    personal,
    shop,
    admin: user.isAdmin ? adminAnalytics(doneRows, keys, now) : undefined,
  };
}

function personalAnalytics(
  user: User,
  doneRows: DoneRow[],
  keys: string[],
  scope: ReturnType<typeof visibilityFilter>,
): PersonalAnalytics {
  const mine = doneRows.filter((r) => r.completedBy === user.id);

  const counts = new Map<string, number>();
  for (const row of mine) {
    const key = localDateString(row.completedAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const series = seriesFrom(keys, counts);

  const lifetime =
    db
      .select({ n: sql<number>`count(*)` })
      .from(tasks)
      .where(and(eq(tasks.status, 'done'), eq(tasks.completedBy, user.id), scope))
      .get()?.n ?? 0;

  // Their own money: what has been settled, and what is still owed to them.
  const money = db
    .select({
      paid: sql<number>`coalesce(sum(case when ${tasks.rewardPaidAt} is not null then ${tasks.rewardCents} else 0 end), 0)`,
      owed: sql<number>`coalesce(sum(case when ${tasks.rewardPaidAt} is null then ${tasks.rewardCents} else 0 end), 0)`,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.status, 'done'),
        eq(tasks.completedBy, user.id),
        isNotNull(tasks.rewardCents),
        gt(tasks.rewardCents, 0),
      ),
    )
    .get();

  const withDue = mine.filter((r) => r.dueAt !== null);
  const onTime = withDue.filter((r) => r.completedAt <= (r.dueAt as number));

  const best = series.reduce<DayPoint | null>(
    (b, p) => (p.count > 0 && (b === null || p.count > b.count) ? p : b),
    null,
  );

  return {
    series,
    done: rangeCounts(series, lifetime),
    paidCents: money?.paid ?? 0,
    owedCents: money?.owed ?? 0,
    streakDays: streakFrom(series),
    bestStreakDays: bestStreakFrom(series),
    bestDay: best,
    asapDone: mine.filter((r) => r.isAsap).length,
    claimedFromPool: mine.filter((r) => r.claimedAt !== null).length,
    onTimePct:
      withDue.length === 0 ? null : Math.round((onTime.length / withDue.length) * 100),
    // Filled in by the caller, which is the only place that has both halves.
    sharePct: 0,
  };
}

function shopAnalytics(
  doneRows: DoneRow[],
  keys: string[],
  scope: ReturnType<typeof visibilityFilter>,
  now: number,
): ShopAnalytics {
  const counts = new Map<string, number>();
  for (const row of doneRows) {
    const key = localDateString(row.completedAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const series = seriesFrom(keys, counts);

  const lifetime =
    db
      .select({ n: sql<number>`count(*)` })
      .from(tasks)
      .where(and(eq(tasks.status, 'done'), scope))
      .get()?.n ?? 0;

  const cutoff30 = now - 30 * DAY_MS;
  const active = new Set(
    doneRows
      .filter((r) => r.completedAt >= cutoff30 && r.completedBy !== null)
      .map((r) => r.completedBy as number),
  );

  const open = db
    .select({ dueAt: tasks.dueAt })
    .from(tasks)
    .where(and(inArray(tasks.status, ['pending', 'accepted']), scope))
    .all();

  return {
    series,
    done: rangeCounts(series, lifetime),
    activePeople: active.size,
    openNow: open.length,
    overdueNow: open.filter((t) => t.dueAt !== null && t.dueAt < now).length,
  };
}

/**
 * The half of the screen that names people and counts money.
 *
 * Everything here is either somebody else's number or the shop's — which is
 * exactly the line the crew payload stops at.
 */
function adminAnalytics(doneRows: DoneRow[], keys: string[], now: number): AdminAnalytics {
  const cutoff30 = now - 30 * DAY_MS;

  const crewRows = db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(isNull(users.archivedAt))
    .all();

  const earned = new Map<number, number>(
    db
      .select({
        userId: tasks.completedBy,
        cents: sql<number>`coalesce(sum(${tasks.rewardCents}), 0)`,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.status, 'done'),
          isNotNull(tasks.completedBy),
          isNotNull(tasks.rewardCents),
        ),
      )
      .groupBy(tasks.completedBy)
      .all()
      .filter((r) => r.userId !== null)
      .map((r) => [r.userId as number, r.cents] as const),
  );

  const crew: CrewRow[] = crewRows
    .map((person) => {
      const theirs = doneRows.filter((r) => r.completedBy === person.id);
      const counts = new Map<string, number>();
      for (const row of theirs) {
        const key = localDateString(row.completedAt);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const series = seriesFrom(keys, counts);
      return {
        userId: person.id,
        name: person.name,
        done30: theirs.filter((r) => r.completedAt >= cutoff30).length,
        earnedCents: earned.get(person.id) ?? 0,
        streakDays: streakFrom(series),
      };
    })
    // Everyone stays on the list, including the zeroes: a crew ranking that
    // silently drops whoever did nothing hides the thing an owner is looking for.
    .sort((a, b) => b.done30 - a.done30 || a.name.localeCompare(b.name));

  const money = db
    .select({
      paidOut: sql<number>`coalesce(sum(case when ${tasks.rewardPaidAt} is not null then ${tasks.rewardCents} else 0 end), 0)`,
      outstanding: sql<number>`coalesce(sum(case when ${tasks.rewardPaidAt} is null then ${tasks.rewardCents} else 0 end), 0)`,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.status, 'done'),
        isNotNull(tasks.completedBy),
        isNotNull(tasks.rewardCents),
        gt(tasks.rewardCents, 0),
      ),
    )
    .get();

  const owedPeople = new Set(
    db
      .select({ userId: tasks.completedBy })
      .from(tasks)
      .where(
        and(
          eq(tasks.status, 'done'),
          isNotNull(tasks.completedBy),
          isNotNull(tasks.rewardCents),
          gt(tasks.rewardCents, 0),
          isNull(tasks.rewardPaidAt),
        ),
      )
      .all()
      .map((r) => r.userId),
  ).size;

  const posted30 = db
    .select({ rewardCents: tasks.rewardCents })
    .from(tasks)
    .where(and(gte(tasks.createdAt, cutoff30), isNotNull(tasks.rewardCents), gt(tasks.rewardCents, 0)))
    .all();

  const recent = doneRows.filter((r) => r.completedAt >= cutoff30);
  const completionTimes = recent.map((r) => r.completedAt - r.createdAt).filter((ms) => ms >= 0);
  const pickupTimes = recent
    .filter((r) => r.claimedAt !== null)
    .map((r) => (r.claimedAt as number) - r.createdAt)
    .filter((ms) => ms >= 0);

  // How reliably the repeating rules actually get done: every instance the
  // scheduler spawned in the window, against the ones that were finished.
  const spawned30 = db
    .select({ status: tasks.status })
    .from(tasks)
    .where(and(isNotNull(tasks.recurrenceId), gte(tasks.createdAt, cutoff30)))
    .all();
  const spawnedDone = spawned30.filter((t) => t.status === 'done').length;

  const declined30 =
    db
      .select({ n: sql<number>`count(*)` })
      .from(tasks)
      .where(and(eq(tasks.status, 'declined'), gte(tasks.updatedAt, cutoff30)))
      .get()?.n ?? 0;

  const supplyRows = db.select({ status: supplyRequests.status }).from(supplyRequests).all();
  const deviceRows = db.select({ status: devices.status }).from(devices).all();

  return {
    crew,
    paidOutCents: money?.paidOut ?? 0,
    outstandingCents: money?.outstanding ?? 0,
    owedPeople,
    bountiedTasks30: posted30.length,
    bountiedCents30: posted30.reduce((sum, t) => sum + (t.rewardCents ?? 0), 0),
    medianCompletionMs: median(completionTimes),
    medianPickupMs: median(pickupTimes),
    recurringDonePct:
      spawned30.length === 0 ? null : Math.round((spawnedDone / spawned30.length) * 100),
    declined30,
    supplies: {
      requested: supplyRows.filter((s) => s.status === 'requested').length,
      ordered: supplyRows.filter((s) => s.status === 'ordered').length,
      received: supplyRows.filter((s) => s.status === 'received').length,
    },
    devices: {
      approved: deviceRows.filter((d) => d.status === 'approved').length,
      pending: deviceRows.filter((d) => d.status === 'pending').length,
    },
  };
}
