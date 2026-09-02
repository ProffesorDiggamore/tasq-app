'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/session';
import * as groups from '@/lib/groups';
import type { ActionResult } from '@/lib/action-result';

/**
 * Tabs are the admin's to shape: who gets one, what it is called, and who is on
 * it. Every one of these goes through requireAdmin, so a crew member who finds
 * the endpoint still cannot make themselves a tab.
 */

function refresh(): void {
  revalidatePath('/');
  revalidatePath('/settings');
}

export async function createGroupAction(name: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  const { groupId: _groupId, ...result } = groups.createGroup(admin, name);
  if (result.ok) refresh();
  return result;
}

export async function renameGroupAction(groupId: number, name: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  const result = groups.renameGroup(admin, groupId, name);
  if (result.ok) refresh();
  return result;
}

export async function archiveGroupAction(groupId: number): Promise<ActionResult> {
  const admin = await requireAdmin();
  const result = groups.archiveGroup(admin, groupId);
  if (result.ok) refresh();
  return result;
}

export async function setGroupMembersAction(
  groupId: number,
  userIds: number[],
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const result = groups.setGroupMembers(admin, groupId, userIds);
  if (result.ok) refresh();
  return result;
}
