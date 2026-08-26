'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users, loginThrottle } from '@/lib/db/schema';
import { requireAdmin, requireUser } from '@/lib/auth/session';
import { changeOwnPin } from '@/lib/change-pin';
import { logActivity } from '@/lib/activity';
import { getOrgName, setSetting } from '@/lib/settings';
import { setThemeKey } from '@/lib/theme';
import { fail, ok, type ActionResult } from '@/lib/action-result';

function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

function countOtherAdmins(exceptId: number): number {
  const row = db
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

  const existing = db.select().from(users).where(eq(users.name, clean)).get();
  if (existing) {
    // Names are unique. Bringing an archived person back is the friendlier answer
    // than refusing, and it keeps their history attached to the same row.
    if (existing.archivedAt !== null) {
      db.update(users).set({ archivedAt: null, isAdmin }).where(eq(users.id, existing.id)).run();
      logActivity({
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

  const inserted = db
    .insert(users)
    .values({ name: clean, isAdmin, createdAt: Date.now() })
    .returning({ id: users.id })
    .get();

  logActivity({
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
  const target = db.select().from(users).where(eq(users.id, userId)).get();
  if (!target) return fail('That person is no longer on the board.');

  const clean = cleanName(name);
  if (clean.length < 2) return fail('Name needs at least two characters.');
  if (clean === target.name) return ok;

  const clash = db.select().from(users).where(eq(users.name, clean)).get();
  if (clash) return fail(`${clean} is already taken.`);

  db.update(users).set({ name: clean }).where(eq(users.id, userId)).run();
  logActivity({
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
  const target = db.select().from(users).where(eq(users.id, userId)).get();
  if (!target) return fail('That person is no longer on the board.');
  // The buyer activated the board with this account; it is the one thing they
  // can never accidentally lose.
  if (target.isFounder && !isAdmin) {
    return fail('The owner account stays an admin.');
  }
  // Without this the shop can lock itself out of Supply Requests and History.
  if (!isAdmin && countOtherAdmins(userId) === 0) {
    return fail('Someone has to stay an admin.');
  }

  db.update(users).set({ isAdmin }).where(eq(users.id, userId)).run();
  logActivity({
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
  const target = db.select().from(users).where(eq(users.id, userId)).get();
  if (!target) return fail('That person is no longer on the board.');
  if (target.id === admin.id) return fail("You can't remove yourself.");
  if (target.isFounder) {
    return fail("The owner account can't be removed.");
  }
  if (target.isAdmin && countOtherAdmins(userId) === 0) {
    return fail('Someone has to stay an admin.');
  }

  db.update(users).set({ archivedAt: Date.now() }).where(eq(users.id, userId)).run();
  logActivity({
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
  const target = db.select().from(users).where(eq(users.id, userId)).get();
  if (!target) return fail('That person is no longer on the board.');

  db.update(users).set({ pinHash: null }).where(eq(users.id, userId)).run();
  db.delete(loginThrottle).where(eq(loginThrottle.userId, userId)).run();

  logActivity({
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

/** The business name shown across the board and on home-screen installs. */
export async function setOrgNameAction(name: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (clean.length < 2) return fail('The name needs at least two characters.');
  if (clean === getOrgName()) return ok;

  setSetting('org.name', clean);
  logActivity({
    actorId: admin.id,
    verb: 'board.renamed',
    subjectType: 'setting',
    subjectId: null,
    summary: `${admin.name} renamed the board to “${clean}”`,
  });
  revalidatePath('/settings');
  revalidatePath('/');
  return ok;
}

/** The accent color every device sees — buttons, tabs, badges, rewards. */
export async function setThemeAction(key: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!setThemeKey(key)) return fail('That theme does not exist.');
  logActivity({
    actorId: admin.id,
    verb: 'board.rethemed',
    subjectType: 'setting',
    subjectId: null,
    summary: `${admin.name} changed the theme`,
  });
  revalidatePath('/', 'layout');
  return ok;
}
