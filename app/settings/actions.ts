'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users, loginThrottle } from '@/lib/db/schema';
import { requireAdmin, requireUser } from '@/lib/auth/session';
import { changeOwnPin } from '@/lib/change-pin';
import { logActivity } from '@/lib/activity';
import { setThemeKey, setAppearance } from '@/lib/theme';
import { setNotifyRule } from '@/lib/notify-policy';
import { NOTIFY_EVENTS, type NotifyEventKey } from '@/lib/notify-events';
import { fail, ok, type ActionResult } from '@/lib/action-result';

function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

async function countOtherAdmins(exceptId: number): Promise<number> {
  const row = await db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .where(and(eq(users.isAdmin, true), isNull(users.archivedAt), ne(users.id, exceptId)))
    .get();
  return row?.n ?? 0;
}

export async function createUserAction(name: string, isAdmin: boolean): Promise<ActionResult> {
  const admin = await requireAdmin();
  const clean = cleanName(name);
  if (clean.length < 2) return fail('Name needs at least two characters.');

  const existing = await db.select().from(users).where(eq(users.name, clean)).get();
  if (existing) {
    // Names are unique. Bringing an archived person back is the friendlier answer
    // than refusing, and it keeps their history attached to the same row.
    if (existing.archivedAt !== null) {
      await db.update(users).set({ archivedAt: null, isAdmin }).where(eq(users.id, existing.id)).run();
      await logActivity({
        actorId: admin.id,
        verb: 'user.updated',
        subjectType: 'user',
        subjectId: existing.id,
        summary: `${admin.name} brought ${clean} back onto the board`,
      });
      revalidatePath('/settings');
      return ok;
    }
    return fail(`${clean} is already on the board.`);
  }

  const inserted = await db
    .insert(users)
    .values({ name: clean, isAdmin, createdAt: Date.now() })
    .returning({ id: users.id })
    .get();

  await logActivity({
    actorId: admin.id,
    verb: 'user.created',
    subjectType: 'user',
    subjectId: inserted.id,
    summary: `${admin.name} added ${clean}${isAdmin ? ' as an admin' : ''}`,
  });
  revalidatePath('/settings');
  return ok;
}

export async function renameUserAction(userId: number, name: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  const target = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!target) return fail('That person is no longer on the board.');

  const clean = cleanName(name);
  if (clean.length < 2) return fail('Name needs at least two characters.');
  if (clean === target.name) return ok;

  const clash = await db.select().from(users).where(eq(users.name, clean)).get();
  if (clash) return fail(`${clean} is already taken.`);

  await db.update(users).set({ name: clean }).where(eq(users.id, userId)).run();
  await logActivity({
    actorId: admin.id,
    verb: 'user.updated',
    subjectType: 'user',
    subjectId: userId,
    summary: `${admin.name} renamed ${target.name} to ${clean}`,
  });
  revalidatePath('/settings');
  return ok;
}

export async function setAdminAction(userId: number, isAdmin: boolean): Promise<ActionResult> {
  const admin = await requireAdmin();
  const target = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!target) return fail('That person is no longer on the board.');
  // The buyer activated the board with this account; it is the one thing they
  // can never accidentally lose.
  if (target.isFounder && !isAdmin) {
    return fail('The owner account stays an admin.');
  }
  // Without this the shop can lock itself out of Supply Requests and History.
  if (!isAdmin && await countOtherAdmins(userId) === 0) {
    return fail('Someone has to stay an admin.');
  }

  await db.update(users).set({ isAdmin }).where(eq(users.id, userId)).run();
  await logActivity({
    actorId: admin.id,
    verb: 'user.updated',
    subjectType: 'user',
    subjectId: userId,
    summary: `${admin.name} ${isAdmin ? 'made' : 'removed'} ${target.name} ${
      isAdmin ? 'an admin' : 'as an admin'
    }`,
  });
  revalidatePath('/settings');
  return ok;
}

/** Soft delete. The person leaves the pickers; every row they touched stays. */
export async function archiveUserAction(userId: number): Promise<ActionResult> {
  const admin = await requireAdmin();
  const target = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!target) return fail('That person is no longer on the board.');
  if (target.id === admin.id) return fail("You can't remove yourself.");
  if (target.isFounder) {
    return fail("The owner account can't be removed.");
  }
  if (target.isAdmin && await countOtherAdmins(userId) === 0) {
    return fail('Someone has to stay an admin.');
  }

  await db.update(users).set({ archivedAt: Date.now() }).where(eq(users.id, userId)).run();
  await logActivity({
    actorId: admin.id,
    verb: 'user.archived',
    subjectType: 'user',
    subjectId: userId,
    summary: `${admin.name} removed ${target.name} from the board`,
  });
  revalidatePath('/settings');
  return ok;
}

/** Clears the hash so the next tap on their name re-enrols, and lifts any lockout. */
export async function resetPinAction(userId: number): Promise<ActionResult> {
  const admin = await requireAdmin();
  const target = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!target) return fail('That person is no longer on the board.');

  await db.update(users).set({ pinHash: null }).where(eq(users.id, userId)).run();
  await db.delete(loginThrottle).where(eq(loginThrottle.userId, userId)).run();

  await logActivity({
    actorId: admin.id,
    verb: 'user.pin_reset',
    subjectType: 'user',
    subjectId: userId,
    summary: `${admin.name} reset ${target.name}'s PIN`,
  });
  revalidatePath('/settings');
  return ok;
}

/** Your own PIN, from inside your own account. Needs the current one. */
export async function changeOwnPinAction(
  currentPin: string,
  newPin: string,
  confirmPin: string,
): Promise<ActionResult> {
  const me = await requireUser();
  const result = await changeOwnPin(me, currentPin, newPin, confirmPin);
  if (result.ok) revalidatePath('/settings');
  return result;
}

/** The accent color every device sees — buttons, tabs, badges, rewards. */
export async function setThemeAction(key: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!await setThemeKey(key)) return fail('That theme does not exist.');
  await logActivity({
    actorId: admin.id,
    verb: 'board.rethemed',
    subjectType: 'setting',
    subjectId: null,
    summary: `${admin.name} changed the theme`,
  });
  revalidatePath('/', 'layout');
  return ok;
}

/** Light, dark, or follow the device — board-wide, like the accent. */
export async function setAppearanceAction(mode: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!await setAppearance(mode)) return fail('That appearance does not exist.');
  await logActivity({
    actorId: admin.id,
    verb: 'board.rethemed',
    subjectType: 'setting',
    subjectId: null,
    summary: `${admin.name} changed the appearance`,
  });
  revalidatePath('/', 'layout');
  return ok;
}

/**
 * Which automatic buzzes this board sends. Admin-only and board-wide: the
 * person who has to answer for a phone going off at 6am is the one who decides
 * what sets it off.
 */
export async function setNotifyRuleAction(
  event: NotifyEventKey,
  enabled: boolean,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!await setNotifyRule(event, enabled)) return fail('That notification does not exist.');
  const spec = NOTIFY_EVENTS.find((candidate) => candidate.key === event)!;
  await logActivity({
    actorId: admin.id,
    verb: 'board.notifications-changed',
    subjectType: 'setting',
    subjectId: null,
    summary: `${admin.name} turned ${enabled ? 'on' : 'off'} notifications for “${spec.label}”`,
  });
  revalidatePath('/settings');
  return ok;
}
