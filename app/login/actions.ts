'use server';

import { eq, isNull, and } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { hashPin, isValidPinFormat, verifyPin } from '@/lib/auth/pin';
import { formatLockout, recordFailure, recordSuccess, throttleState } from '@/lib/auth/throttle';
import { signIn, signOut } from '@/lib/auth/session';
import { logActivity } from '@/lib/activity';
import type { LoginResult } from '@/lib/auth/results';

function activeUser(userId: number) {
  return db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.archivedAt)))
    .get();
}

/** First tap on a name: set a PIN, confirmed twice. */
export async function enrollPinAction(
  userId: number,
  pin: string,
  confirm: string,
): Promise<LoginResult> {
  const user = activeUser(userId);
  if (!user) return { ok: false, reason: 'unknown-user' };
  // Without this, anyone could overwrite an enrolled person's PIN from the picker.
  if (user.pinHash !== null) return { ok: false, reason: 'already-enrolled' };
  if (!isValidPinFormat(pin)) return { ok: false, reason: 'bad-format' };
  if (pin !== confirm) return { ok: false, reason: 'mismatch' };

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
  if (!user) return { ok: false, reason: 'unknown-user' };
  if (user.pinHash === null) return { ok: false, reason: 'not-enrolled' };

  // Checked before the hash so a locked-out attacker cannot even spend our CPU.
  const before = throttleState(user.id);
  if (before.locked) {
    return {
      ok: false,
      reason: 'locked',
      retryAfterMs: before.retryAfterMs,
      message: formatLockout(before.retryAfterMs),
    };
  }

  if (!isValidPinFormat(pin)) return { ok: false, reason: 'bad-format' };

  const good = await verifyPin(pin, user.pinHash);
  if (!good) {
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
        retryAfterMs: after.retryAfterMs,
        message: formatLockout(after.retryAfterMs),
      };
    }
    return { ok: false, reason: 'wrong-pin', attemptsRemaining: after.attemptsRemaining };
  }

  recordSuccess(user.id);
  await signIn(user.id);
  return { ok: true };
}

/** "Switch user" — instant, no logout ceremony, for the shop Mac and the iPads. */
export async function switchUserAction(): Promise<void> {
  await signOut();
}
