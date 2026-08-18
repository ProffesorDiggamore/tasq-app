import 'server-only';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { supplyRequests, users, type SupplyStatus, type User } from '@/lib/db/schema';
import { logActivity } from '@/lib/activity';
import { fail, ok, type ActionResult } from '@/lib/action-result';
import type { NotifyIntent, SupplyRow, SupplyQueue } from '@/lib/board-types';

export type SupplyResult = ActionResult & { notify?: NotifyIntent[] };

const ITEM_MAX = 120;
const QTY_MAX = 60;
const NOTES_MAX = 2000;

const STATUS_ORDER: readonly SupplyStatus[] = ['requested', 'ordered', 'received'];

function clean(value: string, max: number): string {
  return value.trim().slice(0, max);
}

const selection = {
  id: supplyRequests.id,
  item: supplyRequests.item,
  notes: supplyRequests.notes,
  quantity: supplyRequests.quantity,
  status: supplyRequests.status,
  requestedBy: supplyRequests.requestedBy,
  requestedByName: users.name,
  createdAt: supplyRequests.createdAt,
  orderedAt: supplyRequests.orderedAt,
  receivedAt: supplyRequests.receivedAt,
};

function base() {
  return db
    .select(selection)
    .from(supplyRequests)
    .innerJoin(users, eq(users.id, supplyRequests.requestedBy));
}

export function createSupplyRequest(
  actor: User,
  input: { item: string; quantity: string; notes: string },
  now: number = Date.now(),
): SupplyResult & { requestId?: number } {
  const item = clean(input.item, ITEM_MAX);
  if (item.length === 0) return fail('What do you need?');

  const created = db
    .insert(supplyRequests)
    .values({
      item,
      quantity: clean(input.quantity, QTY_MAX) || null,
      notes: clean(input.notes, NOTES_MAX) || null,
      requestedBy: actor.id,
      status: 'requested',
      createdAt: now,
    })
    .returning({ id: supplyRequests.id })
    .get();

  logActivity(
    {
      actorId: actor.id,
      verb: 'supply.created',
      subjectType: 'supply_request',
      subjectId: created.id,
      summary: `${actor.name} asked for ${item}${input.quantity.trim() ? ` (${clean(input.quantity, QTY_MAX)})` : ''}`,
    },
    now,
  );

  return {
    ...ok,
    requestId: created.id,
    notify: [
      {
        // Only admins see the queue, so only admins are told about it.
        audience: { kind: 'admins' },
        title: 'Supply request',
        body: `${item}${input.quantity.trim() ? ` (${clean(input.quantity, QTY_MAX)})` : ''} — ${actor.name}`,
        url: '/supplies',
        tag: `supply-${created.id}`,
      },
    ],
  };
}

/**
 * Moves a request one step along. Guarded on the status it expects to find, so
 * two admins tapping at once cannot skip a step or double-stamp a timestamp.
 */
export function advanceSupplyRequest(
  actor: User,
  requestId: number,
  to: SupplyStatus,
  now: number = Date.now(),
): SupplyResult {
  if (!actor.isAdmin) return fail('Only an admin can move a request along.');

  const current = db
    .select()
    .from(supplyRequests)
    .where(eq(supplyRequests.id, requestId))
    .get();
  if (!current) return fail('That request is gone.');
  if (current.status === to) return ok;

  const from = STATUS_ORDER.indexOf(current.status);
  const target = STATUS_ORDER.indexOf(to);
  if (target < 0) return fail('That is not a status.');
  // Forward one step at a time, or back one to undo a mis-tap.
  if (Math.abs(target - from) !== 1) return fail('Take it one step at a time.');

  const stamps: Partial<{ orderedAt: number | null; receivedAt: number | null }> = {};
  if (to === 'ordered') stamps.orderedAt = now;
  if (to === 'received') stamps.receivedAt = now;
  // Stepping back clears the stamp it is undoing.
  if (to === 'requested') stamps.orderedAt = null;
  if (to === 'ordered') stamps.receivedAt = null;

  const result = db
    .update(supplyRequests)
    .set({ status: to, ...stamps })
    .where(and(eq(supplyRequests.id, requestId), eq(supplyRequests.status, current.status)))
    .run();
  if (result.changes === 0) return fail('Someone else just moved that one.');

  const requester =
    db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, current.requestedBy))
      .get()?.name ?? 'someone';

  logActivity(
    {
      actorId: actor.id,
      verb: to === 'ordered' ? 'supply.ordered' : to === 'received' ? 'supply.received' : 'supply.created',
      subjectType: 'supply_request',
      subjectId: requestId,
      summary: `${actor.name} marked ${current.item} (${requester}'s) as ${to}`,
    },
    now,
  );

  const notify: NotifyIntent[] = [];
  // The requester hears about the two steps that matter to them, and never
  // about their own tap if they happen to be the admin.
  if ((to === 'ordered' || to === 'received') && current.requestedBy !== actor.id) {
    notify.push({
      audience: { kind: 'user', userId: current.requestedBy },
      title: to === 'ordered' ? 'On order' : 'Arrived',
      body: to === 'ordered' ? `${current.item} has been ordered` : `${current.item} is in`,
      url: '/supplies',
      tag: `supply-${requestId}`,
    });
  }

  return { ...ok, notify };
}

export function myRequests(userId: number): SupplyRow[] {
  return base()
    .where(eq(supplyRequests.requestedBy, userId))
    .orderBy(desc(supplyRequests.createdAt))
    .all();
}

/**
 * The whole queue, grouped by status with the oldest outstanding request at the
 * top — Chris reads this as a shopping list, so what has waited longest leads.
 */
export function supplyQueue(): SupplyQueue {
  const rows = base().orderBy(asc(supplyRequests.createdAt)).all();
  return {
    requested: rows.filter((r) => r.status === 'requested'),
    ordered: rows.filter((r) => r.status === 'ordered'),
    // Received is a record, so it reads newest-first.
    received: rows.filter((r) => r.status === 'received').reverse(),
  };
}

/** Badge on the board row: how many are still waiting to be ordered. */
export function outstandingSupplyCount(): number {
  return db
    .select({ id: supplyRequests.id })
    .from(supplyRequests)
    .where(eq(supplyRequests.status, 'requested'))
    .all().length;
}
