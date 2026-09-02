import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { pushSubscriptions } from '@/lib/db/schema';

/**
 * Every subscription row belongs to exactly one person, and every read-modify-
 * write here goes through the session user. The endpoint URL alone never
 * identifies a row: endpoints leak (they sit in browser dev tools, logs, and
 * other people's databases), so trusting one would let any signed-in user
 * unregister or hijack a co-worker's notifications.
 *
 * Kept out of the route handler so the verify scripts can exercise the rules
 * without an HTTP server.
 */

export interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type UpsertResult = { ok: true } | { ok: false; code: 'TASQ-E0402' | 'TASQ-E0404' };

/**
 * Store or refresh this device's subscription for the signed-in person.
 *
 * - No row yet: insert one owned by this user.
 * - Row exists and is theirs: refresh the keys.
 * - Row exists and belongs to someone else: refuse. A shared iPad that swaps
 *   people must unsubscribe (disablePush) before the next person subscribes —
 *   silently re-pointing someone else's device at the new user is exactly the
 *   takeover this refuses to do.
 */
export function upsertSubscription(
  userId: number,
  sub: SubscriptionInput,
  userAgent: string | null,
  now: number = Date.now(),
): UpsertResult {
  if (!sub.endpoint || !sub.p256dh || !sub.auth) return { ok: false, code: 'TASQ-E0402' };

  const existing = db
    .select({ id: pushSubscriptions.id, userId: pushSubscriptions.userId })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, sub.endpoint))
    .get();

  if (existing && existing.userId !== userId) {
    return { ok: false, code: 'TASQ-E0404' };
  }

  const values = {
    userId,
    endpoint: sub.endpoint,
    p256dh: sub.p256dh,
    auth: sub.auth,
    userAgent,
    createdAt: now,
    lastSeenAt: now,
  };

  db.insert(pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      // setWhere is the last line of defence: even if the ownership check above
      // were ever raced past, the update itself refuses to land on a row this
      // user does not own.
      set: { userId, p256dh: sub.p256dh, auth: sub.auth, lastSeenAt: now },
      setWhere: eq(pushSubscriptions.userId, userId),
    })
    .run();

  return { ok: true };
}

export type RemoveResult = { ok: true } | { ok: false; code: 'TASQ-E0402' | 'TASQ-E0406' };

/**
 * Turn notifications off on this device. Only ever touches a row the session
 * user owns: looked up by (userId + endpoint), and a mismatch is a 404-shaped
 * refusal that does not even confirm the endpoint exists for someone else.
 */
export function removeSubscription(userId: number, endpoint: string): RemoveResult {
  if (!endpoint) return { ok: false, code: 'TASQ-E0402' };

  const result = db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .run();

  if (result.changes === 0) return { ok: false, code: 'TASQ-E0406' };
  return { ok: true };
}
