import 'server-only';
import { eq } from 'drizzle-orm';
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

function row(userId: number) {
  return db.select().from(loginThrottle).where(eq(loginThrottle.userId, userId)).get();
}

export function throttleState(userId: number, now: number = Date.now()): ThrottleState {
  const t = row(userId);
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

/** Call after a wrong PIN. Returns the state the person now faces. */
export function recordFailure(userId: number, now: number = Date.now()): ThrottleState {
  const t = row(userId);
  const failedCount = (t?.lockedUntil && t.lockedUntil > now ? t.failedCount : (t?.failedCount ?? 0)) + 1;
  let lockoutLevel = t?.lockoutLevel ?? 0;
  let lockedUntil = t?.lockedUntil ?? null;
  let nextFailedCount = failedCount;

  if (failedCount >= MAX_ATTEMPTS) {
    lockoutLevel += 1;
    const duration = Math.min(BASE_LOCKOUT_MS * 2 ** (lockoutLevel - 1), MAX_LOCKOUT_MS);
    lockedUntil = now + duration;
    // Reset the counter so the next five wrong tries trigger the next, longer lockout.
    nextFailedCount = 0;
  }

  const values = {
    userId,
    failedCount: nextFailedCount,
    lockedUntil,
    lockoutLevel,
    updatedAt: now,
  };
  db.insert(loginThrottle)
    .values(values)
    .onConflictDoUpdate({ target: loginThrottle.userId, set: values })
    .run();

  return throttleState(userId, now);
}

/** Call after a correct PIN — clears the counter and the doubling. */
export function recordSuccess(userId: number, now: number = Date.now()): void {
  const values = {
    userId,
    failedCount: 0,
    lockedUntil: null,
    lockoutLevel: 0,
    updatedAt: now,
  };
  db.insert(loginThrottle)
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
