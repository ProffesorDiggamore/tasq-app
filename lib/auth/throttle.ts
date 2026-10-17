import 'server-only';
import { and, eq, gte, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { loginThrottle } from '@/lib/db/schema';

/** Five tries, then a lockout that doubles every time they burn through another five. */
export const MAX_ATTEMPTS = 5;
const BASE_LOCKOUT_MS = 60_000;
/** 60s → 2m → 4m → … capped so a forgetful employee is never locked out for a day. */
const MAX_LOCKOUT_MS = 30 * 60_000;

export interface ThrottleState {
  locked: boolean;
  /** Milliseconds until the next attempt is allowed. 0 when unlocked. */
  retryAfterMs: number;
  attemptsRemaining: number;
}

async function row(userId: number) {
  return await db.select().from(loginThrottle).where(eq(loginThrottle.userId, userId)).get();
}

export async function throttleState(userId: number, now: number = Date.now()): Promise<ThrottleState> {
  const t = await row(userId);
  if (!t) return { locked: false, retryAfterMs: 0, attemptsRemaining: MAX_ATTEMPTS };
  if (t.lockedUntil && t.lockedUntil > now) {
    return { locked: true, retryAfterMs: t.lockedUntil - now, attemptsRemaining: 0 };
  }
  return {
    locked: false,
    retryAfterMs: 0,
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - t.failedCount),
  };
}

/**
 * Spends one of the five tries BEFORE the PIN is checked, in a single
 * conditional UPDATE. False means there is no try left to spend.
 *
 * Checking the lock first and counting the failure after the hash let any
 * number of guesses fired at once all pass the check before any of them was
 * counted — five tries became as many as a script could send in parallel. With
 * the try claimed up front, the sixth concurrent guess finds the count already
 * at five and is refused without touching the hash. A correct PIN gives the try
 * back (recordSuccess clears the count).
 */
export async function reserveAttempt(userId: number, now: number = Date.now()): Promise<boolean> {
  await db
    .insert(loginThrottle)
    .values({ userId, failedCount: 0, lockedUntil: null, lockoutLevel: 0, updatedAt: now })
    .onConflictDoNothing()
    .run();
  const claimed = await db
    .update(loginThrottle)
    .set({ failedCount: sql`${loginThrottle.failedCount} + 1`, updatedAt: now })
    .where(
      and(
        eq(loginThrottle.userId, userId),
        or(isNull(loginThrottle.lockedUntil), lte(loginThrottle.lockedUntil, now)),
        lt(loginThrottle.failedCount, MAX_ATTEMPTS),
      ),
    )
    .run();
  return claimed.rowsAffected === 1;
}

/**
 * After a wrong PIN whose try was already reserved: if that was the fifth,
 * start the lockout. Atomic too — of several wrong answers landing together,
 * exactly one finds the count at five and doubles the lockout.
 */
export async function settleFailure(userId: number, now: number = Date.now()): Promise<ThrottleState> {
  await db
    .update(loginThrottle)
    .set({
      lockoutLevel: sql`${loginThrottle.lockoutLevel} + 1`,
      // 60s · 2^(level so far), capped — the same doubling as before.
      lockedUntil: sql`${now} + min(${BASE_LOCKOUT_MS} * (1 << ${loginThrottle.lockoutLevel}), ${MAX_LOCKOUT_MS})`,
      // Reset the counter so the next five wrong tries trigger the next, longer lockout.
      failedCount: 0,
      updatedAt: now,
    })
    .where(and(eq(loginThrottle.userId, userId), gte(loginThrottle.failedCount, MAX_ATTEMPTS)))
    .run();
  return await throttleState(userId, now);
}

/** A wrong PIN, start to finish. Returns the state the person now faces. */
export async function recordFailure(userId: number, now: number = Date.now()): Promise<ThrottleState> {
  if (!(await reserveAttempt(userId, now))) return await throttleState(userId, now);
  return await settleFailure(userId, now);
}

/** Call after a correct PIN — clears the counter and the doubling. */
export async function recordSuccess(userId: number, now: number = Date.now()): Promise<void> {
  const values = {
    userId,
    failedCount: 0,
    lockedUntil: null,
    lockoutLevel: 0,
    updatedAt: now,
  };
  await db.insert(loginThrottle)
    .values(values)
    .onConflictDoUpdate({ target: loginThrottle.userId, set: values })
    .run();
}

/** "60 seconds" / "2 minutes" — for the message on the lock screen. */
export function formatLockout(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 90) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
