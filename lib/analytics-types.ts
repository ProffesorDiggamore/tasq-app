/**
 * The shape the Analytics screen reads. Client-safe on purpose: the screen is
 * a client component, and the server decides what goes in here.
 *
 * The tiering is not a UI concern. A crew member's payload simply does not
 * contain the shop's money, anyone else's earnings, or a name-by-name
 * ranking — so there is nothing to hide in the markup, and nothing to leak in
 * a network response someone opens the inspector on.
 */

/** One shop-local day, oldest first in a series. `date` is "YYYY-MM-DD". */
export interface DayPoint {
  date: string;
  count: number;
}

/** The same measure over the three windows the screen can show. */
export interface RangeCounts {
  d7: number;
  d30: number;
  d90: number;
  /** Previous 7 / 30 / 90 days, so the screen can show a delta rather than a bare number. */
  prev7: number;
  prev30: number;
  prev90: number;
  all: number;
}

/** Everything about the person reading the screen. Always present. */
export interface PersonalAnalytics {
  /** Tasqs they finished, per day, last 90 shop-local days. */
  series: DayPoint[];
  done: RangeCounts;
  /** Bounties they have been paid, lifetime, in cents. Their own money. */
  paidCents: number;
  /** Bounties they have earned that are not settled yet. */
  owedCents: number;
  /** Consecutive days finishing at least one Tasq, counting back from today. */
  streakDays: number;
  bestStreakDays: number;
  bestDay: DayPoint | null;
  /** ASAP work they finished in the window. */
  asapDone: number;
  /** Tasqs they took out of Up for Grabs rather than being handed. */
  claimedFromPool: number;
  /** Of the ones with a due time, the share finished before it. Null when none had one. */
  onTimePct: number | null;
  /** Share of the shop's finished work in the last 30 days, 0-100. */
  sharePct: number;
}

/**
 * The shop, as far as this reader is allowed to see it. For a crew member the
 * totals cover only the tabs they are on; for an admin, everything.
 */
export interface ShopAnalytics {
  series: DayPoint[];
  done: RangeCounts;
  /** People who finished at least one Tasq in the last 30 days. A count, never a list. */
  activePeople: number;
  /** Open right now, and how many of those are past due. */
  openNow: number;
  overdueNow: number;
}

/** One row of the crew ranking. Admin-only: it names people and their numbers. */
export interface CrewRow {
  userId: number;
  name: string;
  done30: number;
  /** Lifetime bounties earned, settled or not. */
  earnedCents: number;
  streakDays: number;
}

/** The half of the screen a crew member never receives. */
export interface AdminAnalytics {
  crew: CrewRow[];
  /** Bounties settled, lifetime. */
  paidOutCents: number;
  /** Finished, carried a bounty, still owed. Mirrors the Payouts screen. */
  outstandingCents: number;
  owedPeople: number;
  /** Bounties put on tasks in the last 30 days, and how many of those got taken. */
  bountiedTasks30: number;
  bountiedCents30: number;
  /** Median wall-clock from posting to done, last 30 days, in ms. */
  medianCompletionMs: number | null;
  /** Median from a pool task appearing to somebody claiming it, in ms. */
  medianPickupMs: number | null;
  /** Of the instances a repeating rule spawned in the window, the share finished. */
  recurringDonePct: number | null;
  declined30: number;
  supplies: { requested: number; ordered: number; received: number };
  devices: { approved: number; pending: number };
}

export interface AnalyticsPayload {
  isAdmin: boolean;
  viewerId: number;
  viewerName: string;
  /** The instant the server rendered, so the client formats against one clock. */
  now: number;
  personal: PersonalAnalytics;
  shop: ShopAnalytics;
  /** Present only for an admin. Absent — not empty — for everyone else. */
  admin?: AdminAnalytics;
}

/** The windows the screen offers. */
export type RangeKey = 'd7' | 'd30' | 'd90';

export const RANGE_DAYS: Record<RangeKey, number> = { d7: 7, d30: 30, d90: 90 };
