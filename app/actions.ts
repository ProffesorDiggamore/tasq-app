'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import * as machine from '@/lib/task-machine';
import { dispatchAll } from '@/lib/notify';
import type { NewTaskInput, TaskActionResult } from '@/lib/board-types';
import { ok, fail, type ActionResult } from '@/lib/action-result';

/**
 * Thin wrappers: resolve who is asking, run the transition, revalidate. All the
 * behaviour lives in lib/task-machine.ts so it can be tested without a request.
 */

function refresh(): void {
  revalidatePath('/');
}

async function settle(result: machine.MachineResult): Promise<TaskActionResult> {
  // Even a losing race leaves the caller's board out of date, so it always
  // revalidates — the person needs to see who actually got the task.
  refresh();
  const { notify, ...plain } = result;
  // Sending is awaited so a failure is logged before the response goes out, but
  // dispatch never throws, so it cannot turn a successful action into an error.
  if (notify && notify.length > 0) await dispatchAll(notify);
  return plain;
}

export async function createTaskAction(input: NewTaskInput): Promise<TaskActionResult> {
  const me = await requireUser();
  const { taskId: _taskId, ...result } = machine.createTask(me, input);
  return settle(result);
}

export async function updateTaskAction(
  taskId: number,
  input: NewTaskInput,
): Promise<TaskActionResult> {
  const me = await requireUser();
  return settle(machine.updateTask(me, taskId, input));
}

export async function acceptTaskAction(taskId: number): Promise<TaskActionResult> {
  const me = await requireUser();
  return settle(machine.acceptTask(me, taskId));
}

export async function declineTaskAction(taskId: number, reason: string): Promise<TaskActionResult> {
  const me = await requireUser();
  return settle(machine.declineTask(me, taskId, reason));
}

export async function claimTaskAction(taskId: number): Promise<TaskActionResult> {
  const me = await requireUser();
  return settle(machine.claimTask(me, taskId));
}

export async function completeTaskAction(taskId: number): Promise<TaskActionResult> {
  const me = await requireUser();
  return settle(machine.completeTask(me, taskId));
}

export async function reopenTaskAction(taskId: number): Promise<TaskActionResult> {
  const me = await requireUser();
  return settle(machine.reopenTask(me, taskId));
}

export async function cancelTaskAction(taskId: number): Promise<TaskActionResult> {
  const me = await requireUser();
  return settle(machine.cancelTask(me, taskId));
}

/** Marks the current user as having completed the board walkthrough. */
export async function markTourCompleteAction(): Promise<ActionResult> {
  const me = await requireUser();
  if (me.hasToured) return ok;
  db.update(users).set({ hasToured: true }).where(eq(users.id, me.id)).run();
  return ok;
}
