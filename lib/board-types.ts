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

export type RecurrencePatternInput = 'daily' | 'weekly' | 'monthly';

export interface RecurrenceInput {
  title: string;
  notes: string;
  /** Null spawns each instance straight into the open pool. */
  defaultAssignee: number | null;
  isAsap: boolean;
  pattern: RecurrencePatternInput;
  /** 0 = Sunday. Used only when pattern is 'weekly'. */
  weekdays: number[];
  /** 1-31, clamped to the month's last day. Used only when pattern is 'monthly'. */
  dayOfMonth: number | null;
  /** Shop-local time of day the instance appears, "HH:MM". */
  spawnTime: string;
}

export interface RecurrenceSummary {
  id: number;
  title: string;
  pattern: RecurrencePatternInput;
  weekdays: string | null;
  dayOfMonth: number | null;
  spawnTime: string;
  active: boolean;
  defaultAssignee: number | null;
  assigneeName: string | null;
  isAsap: boolean;
  lastSpawnedOn: string | null;
  /** Rendered server-side so the list reads the same everywhere. */
  schedule: string;
}

export interface SupplyRow {
  id: number;
  item: string;
  notes: string | null;
  quantity: string | null;
  status: 'requested' | 'ordered' | 'received';
  requestedBy: number;
  requestedByName: string;
  createdAt: number;
  orderedAt: number | null;
  receivedAt: number | null;
}

export interface SupplyQueue {
  requested: SupplyRow[];
  ordered: SupplyRow[];
  received: SupplyRow[];
}

/**
 * What a transition wants said, and to whom. The status machine returns these
 * rather than sending anything itself: it stays synchronous and testable, and
 * every send funnels through one place (lib/notify.ts) — which is what lets an
 * SMS adapter be added later without touching feature code.
 */
export type NotifyAudience =
  | { kind: 'user'; userId: number }
  | { kind: 'admins' }
  | { kind: 'everyone'; except?: number };

export interface NotifyIntent {
  audience: NotifyAudience;
  title: string;
  body: string;
  /** Deep link the notification opens. */
  url: string;
  /** Collapses repeats about the same subject instead of stacking them. */
  tag?: string;
  urgent?: boolean;
}
