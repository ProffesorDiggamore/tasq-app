import 'server-only';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { groupMembers, groups, users, type Group, type User } from '@/lib/db/schema';
import { logActivity } from '@/lib/activity';
import { fail, ok, type ActionResult } from '@/lib/action-result';
import type { GroupTab } from '@/lib/board-types';

/**
 * Groups are the tabs across the top of the board. Making one, renaming one,
 * and deciding who is in it are admin acts — everything else about a group is
 * open to its members, who post and finish work there exactly as they do on the
 * shared Tasqs tab.
 *
 * The shared tab is not a row in this table. It is `groupId === null`, so a
 * board with no groups behaves exactly as it did before groups existed.
 */

const NAME_MAX = 32;

function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
}

/** Every live group, in tab order. */
export async function listGroups(): Promise<Group[]> {
  return await db
    .select()
    .from(groups)
    .where(isNull(groups.archivedAt))
    .orderBy(asc(groups.sortOrder), asc(groups.id))
    .all();
}

export async function getGroup(groupId: number): Promise<Group | undefined> {
  return await db.select().from(groups).where(eq(groups.id, groupId)).get();
}

export async function listGroupMemberIds(groupId: number): Promise<number[]> {
  return (await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    .all())
    .map((r) => r.userId);
}

/** Group ids this person belongs to. Admins are not listed here — see below. */
export async function groupIdsForUser(userId: number): Promise<number[]> {
  return (await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.userId, userId), isNull(groups.archivedAt)))
    .all())
    .map((r) => r.groupId);
}

/**
 * An admin runs the board, so every tab is theirs. Everyone else sees the tabs
 * they were put in — which is what makes a group a group rather than a label.
 */
export async function canUseGroup(user: User, groupId: number | null): Promise<boolean> {
  if (groupId === null) return true;
  const group = await getGroup(groupId);
  if (!group || group.archivedAt !== null) return false;
  if (user.isAdmin) return true;
  return (
    await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id)))
      .get() !== undefined
  );
}

/** The tab strip, as the board needs it: the shared tab first, then theirs. */
export async function tabsForUser(user: User): Promise<GroupTab[]> {
  const all = await listGroups();
  const visible = user.isAdmin
    ? all
    : await (async () => {
        const mine = new Set(await groupIdsForUser(user.id));
        return all.filter((g) => mine.has(g.id));
      })();
  return visible.map((g) => ({ id: g.id, name: g.name }));
}

/** Member counts for the whole list in one pass, for the Settings card. */
export async function memberCounts(): Promise<Map<number, number>> {
  const rows = await db
    .select({ groupId: groupMembers.groupId, n: sql<number>`count(*)` })
    .from(groupMembers)
    .groupBy(groupMembers.groupId)
    .all();
  return new Map(rows.map((r) => [r.groupId, r.n]));
}

export async function createGroup(actor: User, rawName: string, now: number = Date.now()): Promise<ActionResult & {
  groupId?: number;
}> {
  const name = cleanName(rawName);
  if (name.length < 2) return fail('A tab name needs at least two characters.');
  if (name.toLowerCase() === 'tasqs') return fail('Tasqs is the shared tab — pick another name.');

  const existing = await db.select().from(groups).where(eq(groups.name, name)).get();
  if (existing) {
    // Names are unique across archived groups too, so reviving is friendlier
    // than refusing — and it keeps the old tab's tasks attached to it.
    if (existing.archivedAt !== null) {
      await db.update(groups).set({ archivedAt: null }).where(eq(groups.id, existing.id)).run();
      await logActivity({
        actorId: actor.id,
        verb: 'group.created',
        subjectType: 'group',
        subjectId: existing.id,
        summary: `${actor.name} brought the ${name} tab back`,
      }, now);
      return { ...ok, groupId: existing.id };
    }
    return fail(`There is already a ${name} tab.`);
  }

  const last = await db
    .select({ n: sql<number>`coalesce(max(${groups.sortOrder}), -1)` })
    .from(groups)
    .get();

  const created = await db
    .insert(groups)
    .values({
      name,
      sortOrder: (last?.n ?? -1) + 1,
      createdBy: actor.id,
      createdAt: now,
    })
    .returning({ id: groups.id })
    .get();

  await logActivity({
    actorId: actor.id,
    verb: 'group.created',
    subjectType: 'group',
    subjectId: created.id,
    summary: `${actor.name} added the ${name} tab`,
  }, now);

  return { ...ok, groupId: created.id };
}

export async function renameGroup(actor: User, groupId: number, rawName: string, now: number = Date.now()): Promise<ActionResult> {
  const group = await getGroup(groupId);
  if (!group || group.archivedAt !== null) return fail('That tab is gone.');

  const name = cleanName(rawName);
  if (name.length < 2) return fail('A tab name needs at least two characters.');
  if (name === group.name) return ok;
  if (name.toLowerCase() === 'tasqs') return fail('Tasqs is the shared tab — pick another name.');

  const clash = await db.select().from(groups).where(eq(groups.name, name)).get();
  if (clash) return fail(`There is already a ${name} tab.`);

  await db.update(groups).set({ name }).where(eq(groups.id, groupId)).run();
  await logActivity({
    actorId: actor.id,
    verb: 'group.updated',
    subjectType: 'group',
    subjectId: groupId,
    summary: `${actor.name} renamed the ${group.name} tab to ${name}`,
  }, now);
  return ok;
}

/**
 * Soft delete. The tab leaves the board; the tasks that were on it keep their
 * `groupId` and stay in History, exactly like an archived person's work.
 */
export async function archiveGroup(actor: User, groupId: number, now: number = Date.now()): Promise<ActionResult> {
  const group = await getGroup(groupId);
  if (!group || group.archivedAt !== null) return fail('That tab is gone.');

  await db.update(groups).set({ archivedAt: now }).where(eq(groups.id, groupId)).run();
  await logActivity({
    actorId: actor.id,
    verb: 'group.archived',
    subjectType: 'group',
    subjectId: groupId,
    summary: `${actor.name} removed the ${group.name} tab`,
  }, now);
  return ok;
}

/** Replaces the whole membership in one go — the UI edits it as a set. */
export async function setGroupMembers(
  actor: User,
  groupId: number,
  userIds: number[],
  now: number = Date.now(),
): Promise<ActionResult> {
  const group = await getGroup(groupId);
  if (!group || group.archivedAt !== null) return fail('That tab is gone.');

  const wanted = [...new Set(userIds)];
  const real =
    wanted.length === 0
      ? []
      : (await db
          .select({ id: users.id })
          .from(users)
          .where(and(inArray(users.id, wanted), isNull(users.archivedAt)))
          .all())
          .map((r) => r.id);

  await db.delete(groupMembers).where(eq(groupMembers.groupId, groupId)).run();
  for (const userId of real) {
    await db.insert(groupMembers).values({ groupId, userId, addedAt: now }).run();
  }

  await logActivity({
    actorId: actor.id,
    verb: 'group.updated',
    subjectType: 'group',
    subjectId: groupId,
    summary: `${actor.name} set the ${group.name} tab to ${real.length} ${
      real.length === 1 ? 'person' : 'people'
    }`,
  }, now);
  return ok;
}
