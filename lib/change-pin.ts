import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users, type User } from '@/lib/db/schema';
import { hashPin, isValidPinFormat, verifyPin } from '@/lib/auth/pin';
import { formatLockout, recordFailure, recordSuccess, throttleState } from '@/lib/auth/throttle';
import { logActivity } from '@/lib/activity';
import { fail, ok, type ActionResult } from '@/lib/action-result';

/**
 * Changing your own PIN, from inside your own account. Distinct from an admin
 * reset, which clears the hash so the next tap re-enrols — this one proves you
 * know the current PIN first.
 *
 * The same throttle guards it as the login screen. A signed-in session is not a
 * licence to brute-force the four digits: a phone left unlocked on a bench is
 * exactly the case this protects against.
 */
export async function changeOwnPin(
  actor: User,
  currentPin: string,
  newPin: string,
  confirmPin: string,
  now: number = Date.now(),
): Promise<ActionResult> {
  if (actor.pinHash === null) return fail('You have no PIN set yet.');

  const before = throttleState(actor.id, now);
  if (before.locked) {
    return fail(`Too many tries. Wait ${formatLockout(before.retryAfterMs)}.`);
  }

  if (!isValidPinFormat(currentPin)) return fail('Enter your current 4-digit PIN.');

  if (!(await verifyPin(currentPin, actor.pinHash))) {
    const after = recordFailure(actor.id, now);
    logActivity(
      {
        actorId: actor.id,
        verb: 'auth.failed',
        subjectType: 'user',
        subjectId: actor.id,
        summary: after.locked
          ? `Wrong current PIN while ${actor.name} was changing it — locked out for ${formatLockout(after.retryAfterMs)}`
          : `Wrong current PIN while ${actor.name} was changing it (${after.attemptsRemaining} tries left)`,
      },
      now,
    );
    return fail(
      after.locked
        ? `Too many tries. Wait ${formatLockout(after.retryAfterMs)}.`
        : `That isn't your current PIN — ${after.attemptsRemaining} ${
            after.attemptsRemaining === 1 ? 'try' : 'tries'
          } left.`,
    );
  }

  if (!isValidPinFormat(newPin)) return fail('Your new PIN has to be 4 digits.');
  if (newPin !== confirmPin) return fail("Those didn't match. Start again.");
  if (newPin === currentPin) return fail('That is already your PIN.');

  db.update(users).set({ pinHash: await hashPin(newPin) }).where(eq(users.id, actor.id)).run();
  recordSuccess(actor.id, now);

  logActivity(
    {
      actorId: actor.id,
      verb: 'user.pin_changed',
      subjectType: 'user',
      subjectId: actor.id,
      // Deliberately says nothing about the PIN itself.
      summary: `${actor.name} changed their PIN`,
    },
    now,
  );

  return ok;
}
