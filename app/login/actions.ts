'use server';

import { headers } from 'next/headers';
import { eq, isNull, and } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { hashPin, isValidPinFormat, verifyPin } from '@/lib/auth/pin';
import { formatLockout, recordFailure, recordSuccess, throttleState } from '@/lib/auth/throttle';
import { signIn, signOut } from '@/lib/auth/session';
import { logActivity } from '@/lib/activity';
import { rateLimit } from '@/lib/rate-limit';
import type { LoginResult } from '@/lib/auth/results';

function activeUser(userId: number) {
  return db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.archivedAt)))
    .get();
}

/** The caller's address, as far as a single-server deployment can know it. */
async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return h.get('x-real-ip') ?? 'local';
}

/**
 * The per-person lockout in lib/auth/throttle.ts only guards one account — an
 * attacker can still walk the picker and spend ten wrong guesses on every
 * name. This per-address counter closes that: ten wrong PINs in ten minutes
 * from one address ends the sweep for the whole window.
 */
async function ipFailureBudget(): Promise<LoginResult | null> {
  const limit = rateLimit(`login:fail:${await clientIp()}`, 10, 10 * 60_000);
  if (!limit.allowed) {
    return {
      ok: false,
      reason: 'locked',
      code: 'TASQ-E0111',
      retryAfterMs: limit.retryAfterMs,
      message: formatLockout(limit.retryAfterMs),
    };
  }
  return null;
}

/** First tap on a name: set a PIN, confirmed twice. */
export async function enrollPinAction(
  userId: number,
  pin: string,
  confirm: string,
): Promise<LoginResult> {
  const user = activeUser(userId);
  if (!user) return { ok: false, reason: 'unknown-user', code: 'TASQ-E0109' };
  // Without this, anyone could overwrite an enrolled person's PIN from the picker.
  if (user.pinHash !== null) return { ok: false, reason: 'already-enrolled', code: 'TASQ-E0107' };
  if (!isValidPinFormat(pin)) return { ok: false, reason: 'bad-format', code: 'TASQ-E0105' };
  if (pin !== confirm) return { ok: false, reason: 'mismatch', code: 'TASQ-E0106' };

  const pinHash = await hashPin(pin);
  db.update(users).set({ pinHash }).where(eq(users.id, userId)).run();
  recordSuccess(userId);
  logActivity({
    actorId: userId,
    verb: 'user.pin_enrolled',
    subjectType: 'user',
    subjectId: userId,
    summary: `${user.name} set up their PIN`,
  });
  await signIn(userId);
  return { ok: true };
}

/** Every later tap on a name. */
export async function submitPinAction(userId: number, pin: string): Promise<LoginResult> {
  const user = activeUser(userId);
  if (!user) return { ok: false, reason: 'unknown-user', code: 'TASQ-E0109' };
  if (user.pinHash === null) return { ok: false, reason: 'not-enrolled', code: 'TASQ-E0108' };

  // Checked before the hash so a locked-out attacker cannot even spend our CPU.
  const before = throttleState(user.id);
  if (before.locked) {
    return {
      ok: false,
      reason: 'locked',
      code: 'TASQ-E0104',
      retryAfterMs: before.retryAfterMs,
      message: formatLockout(before.retryAfterMs),
    };
  }

  if (!isValidPinFormat(pin)) return { ok: false, reason: 'bad-format', code: 'TASQ-E0105' };

  const good = await verifyPin(pin, user.pinHash);
  if (!good) {
    const ipBlocked = await ipFailureBudget();
    if (ipBlocked) return ipBlocked;

    const after = recordFailure(user.id);
    logActivity({
      actorId: user.id,
      verb: 'auth.failed',
      subjectType: 'user',
      subjectId: user.id,
      summary: after.locked
        ? `Failed PIN for ${user.name} — locked out for ${formatLockout(after.retryAfterMs)}`
        : `Failed PIN for ${user.name} (${after.attemptsRemaining} tries left)`,
    });
    if (after.locked) {
      return {
        ok: false,
        reason: 'locked',
        code: 'TASQ-E0104',
        retryAfterMs: after.retryAfterMs,
        message: formatLockout(after.retryAfterMs),
      };
    }
    return { ok: false, reason: 'wrong-pin', code: 'TASQ-E0103', attemptsRemaining: after.attemptsRemaining };
  }

  recordSuccess(user.id);
  await signIn(user.id);
  return { ok: true };
}

/** "Switch user" — instant, no logout ceremony, for the shop Mac and the iPads. */
export async function switchUserAction(): Promise<void> {
  await signOut();
}
