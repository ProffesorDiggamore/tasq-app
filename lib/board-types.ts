import type { TaskStatus } from '@/lib/db/schema';

/** A task flattened for the browser: names resolved, no joins to follow. */
export interface BoardTask {
  id: number;
  title: string;
  notes: string | null;
  createdBy: number;
  createdByName: string;
  assignedTo: number | null;
  assignedToName: string | null;
  isAsap: boolean;
  dueAt: number | null;
  status: TaskStatus;
  completedAt: number | null;
  completedBy: number | null;
  completedByName: string | null;
  declineReason: string | null;
  isRecurring: boolean;
  createdAt: number;
}

export interface BoardData {
  asap: BoardTask[];
  mine: BoardTask[];
  pool: BoardTask[];
  recurring: BoardTask[];
  done: BoardTask[];
  asapCount: number;
  awaitingYou: number;
}

/**
 * Mutations answer with what actually happened rather than throwing, because
 * most failures here are two people acting at the same second — which is normal
 * on a shared board, not an error.
 */
export type TaskActionResult =
  | { ok: true }
  | { ok: false; reason: 'claimed'; by: string }
  | { ok: false; reason: 'gone' }
  | { ok: false; reason: 'stale'; message: string }
  | { ok: false; reason: 'invalid'; message: string };

export interface NewTaskInput {
  title: string;
  notes: string;
  /** Null means "Anyone" — the task lands in the open pool. */
  assignedTo: number | null;
  isAsap: boolean;
  /** Shop-local wall clock, "YYYY-MM-DDTHH:MM", exactly as the input gives it. */
  dueLocal: string | null;
}
