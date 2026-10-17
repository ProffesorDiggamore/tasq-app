import 'server-only';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
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

/** How many stale rows the last upsert retired. Only the verify script reads it. */
export interface UpsertOk {
  ok: true;
  /** Superseded subscriptions for this same device, now deleted. */
  replaced: number;
}

export type UpsertResult = UpsertOk | { ok: false; code: 'TASQ-E0402' | 'TASQ-E0404' };

/**
 * Store or refresh this device's subscription for the signed-in person.
 *
 * - No row yet: insert one owned by this user.
 * - Row exists and is theirs: refresh the keys.
 * - Row exists and belongs to someone else: refuse. A shared iPad that swaps
 *   people must unsubscribe (disablePush) before the next person subscribes —
 *   silently re-pointing someone else's device at the new user is exactly the
 *   takeover this refuses to do.
 *
 * Then, with `deviceHash` known, any OTHER row this person holds for the same
 * device is deleted. A phone does not keep its push endpoint across a reinstall
 * or a service-worker replacement — it subscribes again and gets a fresh URL,
 * while the old endpoint goes on accepting pushes for days. Both rows then pass
 * the endpoint-unique index, both deliver, and the phone buzzes twice for every
 * job. One device, one subscription. Rows with no hash (written before this
 * column, or by a browser holding no cookie yet) are left alone rather than
 * guessed at.
 */
export async function upsertSubscription(
  userId: number,
  sub: SubscriptionInput,
  userAgent: string | null,
  deviceHash: string | null = null,
  now: number = Date.now(),
): Promise<UpsertResult> {
  if (!sub.endpoint || !sub.p256dh || !sub.auth) return { ok: false, code: 'TASQ-E0402' };

  const existing = await db
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
    deviceHash,
    createdAt: now,
    lastSeenAt: now,
  };

  await db.insert(pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      // setWhere is the last line of defence: even if the ownership check above
      // were ever raced past, the update itself refuses to land on a row this
      // user does not own.
      set: { userId, p256dh: sub.p256dh, auth: sub.auth, deviceHash, lastSeenAt: now },
      setWhere: eq(pushSubscriptions.userId, userId),
    })
    .run();

  if (deviceHash === null) return { ok: true, replaced: 0 };

  const superseded = await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.deviceHash, deviceHash),
        isNotNull(pushSubscriptions.deviceHash),
        ne(pushSubscriptions.endpoint, sub.endpoint),
      ),
    )
    .run();

  return { ok: true, replaced: superseded.rowsAffected };
}

/**
 * Whether this endpoint is registered to this person. A shared shop tablet holds
 * ONE browser subscription, so "the browser has a subscription" says nothing
 * about whether the person signed in right now will get anything through it.
 */
export async function ownsSubscription(userId: number, endpoint: string): Promise<boolean> {
  if (!endpoint) return false;
  return (
    await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
      .get() !== undefined
  );
}

export type RemoveResult = { ok: true } | { ok: false; code: 'TASQ-E0402' | 'TASQ-E0406' };

/**
 * Turn notifications off on this device. Only ever touches a row the session
 * user owns: looked up by (userId + endpoint), and a mismatch is a 404-shaped
 * refusal that does not even confirm the endpoint exists for someone else.
 */
export async function removeSubscription(userId: number, endpoint: string): Promise<RemoveResult> {
  if (!endpoint) return { ok: false, code: 'TASQ-E0402' };

  const result = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .run();

  if (result.rowsAffected === 0) return { ok: false, code: 'TASQ-E0406' };
  return { ok: true };
}
