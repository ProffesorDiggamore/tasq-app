'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { advanceSupplyRequest, createSupplyRequest } from '@/lib/supplies';
import { dispatchAll } from '@/lib/notify';
import type { SupplyStatus } from '@/lib/db/schema';
import type { ActionResult } from '@/lib/action-result';

export async function createSupplyRequestAction(input: {
  item: string;
  quantity: string;
  notes: string;
}): Promise<ActionResult> {
  const me = await requireUser();
  const { requestId: _id, notify, ...plain } = createSupplyRequest(me, input);
  revalidatePath('/supplies');
  revalidatePath('/');
  if (notify) await dispatchAll(notify);
  return plain;
}

export async function advanceSupplyRequestAction(
  requestId: number,
  to: SupplyStatus,
): Promise<ActionResult> {
  const me = await requireUser();
  const { notify, ...plain } = advanceSupplyRequest(me, requestId, to);
  revalidatePath('/supplies');
  revalidatePath('/');
  if (notify) await dispatchAll(notify);
  return plain;
}
