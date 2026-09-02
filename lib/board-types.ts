import type { TaskStatus } from '@/lib/db/schema';

/**
 * One tab across the top of the board. The shared "Tasqs" tab is not in this
 * list — it is the absence of a group, so a board with no groups is unchanged.
 */
export interface GroupTab {
  id: number;
  name: string;
}

/** A task flattened for the browser: names resolved, no joins to follow. */
export interface BoardTask {
  id: number;
  title: string;
  notes: string | null;
  createdBy: number;
  createdByName: string;
  assignedTo: number | null;
  assignedToName: string | null;
  /** Which tab it lives on; null is the shared Tasqs tab. */
  groupId: number | null;
  isAsap: boolean;
  dueAt: number | null;
  status: TaskStatus;
  completedAt: number | null;
  completedBy: number | null;
  completedByName: string | null;
  declineReason: string | null;
  isRecurring: boolean;
  /** Bounty in whole cents; null means no cash value. */
  rewardCents: number | null;
  /** True when optional photo proof exists — the board then shows a thumbnail. */
  hasPhoto: boolean;
  /** Epoch ms the photo was last written; cache-busts the <img> URL. */
  photoUpdatedAt: number | null;
  createdAt: number;
}

export interface BoardData {
  /** The tab this board was loaded for; null is the shared Tasqs tab. */
  groupId: number | null;
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
  /** Which tab to post it to; omitted or null is the shared Tasqs tab. */
  groupId?: number | null;
  isAsap: boolean;
  /** Shop-local wall clock, "YYYY-MM-DDTHH:MM", exactly as the input gives it. */
  dueLocal: string | null;
  /** Bounty in whole dollars-and-cents the completer pockets. */
  rewardCents: number | null;
}

export type RecurrencePatternInput = 'daily' | 'weekly' | 'monthly';

export interface RecurrenceInput {
  title: string;
  notes: string;
  /** Null spawns each instance straight into the open pool. */
  defaultAssignee: number | null;
  /** Which tab each spawned instance lands on; omitted or null is shared Tasqs. */
  groupId?: number | null;
  isAsap: boolean;
  pattern: RecurrencePatternInput;
  /** 0 = Sunday. Used only when pattern is 'weekly'. */
  weekdays: number[];
  /** 1-31, clamped to the month's last day. Used only when pattern is 'monthly'. */
  dayOfMonth: number | null;
  /** Shop-local time of day the instance appears, "HH:MM". */
  spawnTime: string;
  rewardCents: number | null;
}

export interface RecurrenceSummary {
  id: number;
  title: string;
  notes: string | null;
  pattern: RecurrencePatternInput;
  weekdays: string | null;
  dayOfMonth: number | null;
  spawnTime: string;
  active: boolean;
  defaultAssignee: number | null;
  assigneeName: string | null;
  groupId: number | null;
  groupName: string | null;
  isAsap: boolean;
  rewardCents: number | null;
  lastSpawnedOn: string | null;
  /** Rendered server-side so the list reads the same everywhere. */
  schedule: string;
}

/** One browser in the Settings → Devices list. */
export interface DeviceRow {
  id: number;
  label: string;
  status: 'pending' | 'approved' | 'blocked';
  firstSeenAt: number;
  lastSeenAt: number;
  /** Last account signed in on it, if any — what makes a row recognisable. */
  lastUserName: string | null;
}

/** One unpaid, finished, rewarded job. */
export interface PayoutTask {
  id: number;
  title: string;
  rewardCents: number;
  completedAt: number;
}

/** One person the shop still owes. Nobody at zero is ever in this list. */
export interface PayoutPerson {
  userId: number;
  name: string;
  cents: number;
  taskCount: number;
  /** When the oldest unpaid job was finished — how long they have waited. */
  oldestAt: number;
  tasks: PayoutTask[];
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
  /** Everyone in one tab, plus the admins who can see every tab. */
  | { kind: 'group'; groupId: number; except?: number }
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
