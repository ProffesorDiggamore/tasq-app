'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/session';
import { markPersonPaid, markTaskPaid } from '@/lib/payouts';
import type { ActionResult } from '@/lib/action-result';

/** Settling a bounty is spending the shop's money, so both go through requireAdmin. */

function refresh(): void {
  revalidatePath('/payouts');
  revalidatePath('/settings');
}

export async function markPersonPaidAction(userId: number): Promise<ActionResult> {
  const admin = await requireAdmin();
  const { cents: _cents, ...result } = markPersonPaid(admin, userId);
  if (result.ok) refresh();
  return result;
}

export async function markTaskPaidAction(taskId: number): Promise<ActionResult> {
  const admin = await requireAdmin();
  const result = markTaskPaid(admin, taskId);
  if (result.ok) refresh();
  return result;
}
