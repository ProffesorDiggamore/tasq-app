'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import {
  createRecurrence,
  deleteRecurrence,
  setRecurrenceActive,
  spawnDueRecurrences,
  updateRecurrence,
} from '@/lib/recurrences';
import type { RecurrenceInput } from '@/lib/board-types';
import type { ActionResult } from '@/lib/action-result';

export async function createRecurrenceAction(input: RecurrenceInput): Promise<ActionResult> {
  const me = await requireUser();
  const result = createRecurrence(me, input);
  if (result.ok) {
    // If the rule is due today and its time has already passed, the first
    // instance should be on the board now rather than tomorrow morning.
    spawnDueRecurrences();
  }
  revalidatePath('/');
  revalidatePath('/settings');
  const { recurrenceId: _id, ...plain } = result;
  return plain;
}

export async function updateRecurrenceAction(
  recurrenceId: number,
  input: RecurrenceInput,
): Promise<ActionResult> {
  const me = await requireUser();
  const result = updateRecurrence(me, recurrenceId, input);
  revalidatePath('/settings');
  revalidatePath('/');
  return result;
}

export async function deleteRecurrenceAction(recurrenceId: number): Promise<ActionResult> {
  const me = await requireUser();
  const result = deleteRecurrence(me, recurrenceId);
  revalidatePath('/settings');
  revalidatePath('/');
  return result;
}

export async function setRecurrenceActiveAction(
  recurrenceId: number,
  active: boolean,
): Promise<ActionResult> {
  const me = await requireUser();
  const result = setRecurrenceActive(me, recurrenceId, active);
  revalidatePath('/settings');
  revalidatePath('/');
  return result;
}
