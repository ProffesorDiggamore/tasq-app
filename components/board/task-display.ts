import type { BoardData, BoardTask } from '@/lib/board-types';
import { formatShort, relativeTime } from '@/lib/time';

export type CardAction = 'accept' | 'decline' | 'claim' | 'complete' | 'reopen';

export interface MyDaySections {
  /** Work that already belongs to the signed-in person. */
  mine: BoardTask[];
  /** Urgent work visible to the team, excluding work already shown in mine. */
  urgent: BoardTask[];
  /** Claimable work, excluding urgent cards already surfaced above it. */
  available: BoardTask[];
  /** Remaining recurring work that the old recurring rail exposed to the team. */
  teamToday: BoardTask[];
}

/**
 * Turns the overlapping board queries into one calm daily hierarchy.
 *
 * The database intentionally returns the same task through several lenses: an
 * ASAP assigned to you is both `asap` and `mine`, and a repeating task is also
 * present in its normal ownership row. The old homepage rendered every lens as
 * a separate rail, so one urgent repeat could appear three times. My Day keeps
 * every behaviour and action but assigns each open task to its first useful
 * section, exactly once.
 */
export function myDaySections(board: BoardData): MyDaySections {
  const shown = new Set<number>();
  const unique = (tasks: BoardTask[]) =>
    tasks.filter((task) => {
      if (shown.has(task.id)) return false;
      shown.add(task.id);
      return task.status !== 'done' && task.status !== 'cancelled';
    });

  return {
    mine: unique(board.mine),
    urgent: unique(board.asap),
    available: unique(board.pool),
    teamToday: unique(board.recurring),
  };
}

/**
 * What a person can do with this card *from the row* — the sheet offers the
 * rest. Deliberately at most two, so a card never becomes a control panel.
 */
export function cardActions(task: BoardTask, viewerId: number): CardAction[] {
  if (task.status === 'done') return ['reopen'];
  if (task.status === 'cancelled') return [];
  if (task.assignedTo === null) return ['claim'];
  if (task.assignedTo === viewerId && task.status === 'pending') return ['accept', 'decline'];
  return ['complete'];
}

export interface DueDisplay {
  label: string;
  /** Past due, and still not done. */
  overdue: boolean;
}

export function dueDisplay(task: BoardTask, now: number = Date.now()): DueDisplay | null {
  if (task.dueAt === null) return null;
  const overdue = task.dueAt < now && task.status !== 'done';
  // Inside a day, "in 20 min" beats "Mon 9:00 AM" — it is the number the person
  // is actually doing arithmetic on.
  const withinADay = Math.abs(task.dueAt - now) < 20 * 60 * 60 * 1000;
  return {
    label: withinADay ? relativeTime(task.dueAt, now) : formatShort(task.dueAt),
    overdue,
  };
}

/** The one line under the title: who owns it, or who finished it. */
export function ownerLine(task: BoardTask, viewerId: number): string {
  if (task.status === 'done') {
    const who = task.completedBy === viewerId ? 'You' : (task.completedByName ?? 'Someone');
    return `${who} finished it`;
  }
  if (task.assignedTo === null) return `Unclaimed · from ${task.createdByName}`;
  const who = task.assignedTo === viewerId ? 'You' : task.assignedToName;
  if (task.createdBy === task.assignedTo) return `${who}`;
  return `${who} · from ${task.createdByName}`;
}
