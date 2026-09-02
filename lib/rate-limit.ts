/**
 * In-process rate limiting, no external deps. This is a single-Mac deployment
 * with one Node server, so a Map is the whole story — no Redis, no sticky
 * sessions to worry about. State is deliberately not persisted: a restart
 * forgives everyone, which is the kind thing for a shop behind a shared NAT.
 *
 * Two flavours:
 *  - rateLimit(): a fixed-window counter for polite endpoints (push changes),
 *    where the question is "too many requests right now?".
 *  - penalty()/penaltyState(): a tightening, doubling backoff for
 *    guessable-secret endpoints (setup codes, PINs), where every failure buys
 *    the next attempt a longer wait. Mirrors the shape of lib/auth/throttle.ts
 *    but keyed by request origin rather than user, so it also catches someone
 *    cycling through every name on the login picker.
 *
 * Keys are plain strings ("push:delete:<ip>", "setup:fail:<ip>"). A periodic
 * sweep drops stale buckets so the map cannot grow without bound.
 */

interface WindowBucket {
  windowStart: number;
  count: number;
}

interface PenaltyBucket {
  /** Attempts counted inside the current decay window. */
  failures: number;
  /** Epoch ms before which attempts are refused outright. */
  blockedUntil: number;
  /** Last failure inside the decay window, so failures expire too. */
  lastFailure: number;
}

const windows = new Map<string, WindowBucket>();
const penalties = new Map<string, PenaltyBucket>();

/** Failures older than this stop counting toward the backoff ladder. */
const FAILURE_DECAY_MS = 15 * 60_000;
/** Sweep interval; both maps are tiny, so this is just hygiene. */
const SWEEP_EVERY_MS = 10 * 60_000;
let lastSweepAt = 0;

function sweep(now: number): void {
  if (now - lastSweepAt < SWEEP_EVERY_MS) return;
  lastSweepAt = now;
  for (const [key, bucket] of windows) {
    if (now - bucket.windowStart > FAILURE_DECAY_MS) windows.delete(key);
  }
  for (const [key, bucket] of penalties) {
    if (now - bucket.lastFailure > FAILURE_DECAY_MS && bucket.blockedUntil < now) {
      penalties.delete(key);
    }
  }
}

export interface RateDecision {
  allowed: boolean;
  /** Milliseconds until the window frees up. 0 when allowed. */
  retryAfterMs: number;
}

/** Fixed window: at most `max` hits per `windowMs` per key. */
export function rateLimit(key: string, max: number, windowMs: number, now: number = Date.now()): RateDecision {
  sweep(now);
  const bucket = windows.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    windows.set(key, { windowStart: now, count: 1 });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (bucket.count < max) {
    bucket.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }
  return { allowed: false, retryAfterMs: bucket.windowStart + windowMs - now };
}

export interface PenaltyDecision {
  blocked: boolean;
  /** Milliseconds until the next attempt may proceed. 0 when not blocked. */
  retryAfterMs: number;
}

/** Ask whether a key is currently serving a backoff penalty. */
export function penaltyState(key: string, now: number = Date.now()): PenaltyDecision {
  const bucket = penalties.get(key);
  if (!bucket || bucket.blockedUntil <= now) return { blocked: false, retryAfterMs: 0 };
  return { blocked: true, retryAfterMs: bucket.blockedUntil - now };
}

/**
 * Register a failure and return the fresh state. Each failure inside the decay
 * window doubles the next lockout: base, base*2, base*4 … capped at maxMs.
 * A success clears it (clearPenalty).
 */
export function recordPenalty(
  key: string,
  baseMs: number,
  maxMs: number,
  now: number = Date.now(),
): PenaltyDecision {
  sweep(now);
  const bucket = penalties.get(key);
  // Failures that happened too long ago do not escalate the ladder.
  const carried = bucket && now - bucket.lastFailure < FAILURE_DECAY_MS ? bucket.failures : 0;
  const failures = carried + 1;
  const duration = Math.min(baseMs * 2 ** (failures - 1), maxMs);
  const next: PenaltyBucket = {
    failures,
    blockedUntil: now + duration,
    lastFailure: now,
  };
  penalties.set(key, next);
  return { blocked: true, retryAfterMs: duration };
}

/** A success wipes the ladder — the person got it right, start over. */
export function clearPenalty(key: string): void {
  penalties.delete(key);
}

/** Test hook: empty both maps so a verify script starts from a clean slate. */
export function __resetRateLimiterForTests(): void {
  windows.clear();
  penalties.clear();
  lastSweepAt = 0;
}
