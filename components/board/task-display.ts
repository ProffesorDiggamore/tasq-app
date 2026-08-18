import type { BoardTask } from '@/lib/board-types';
import { formatShort, relativeTime } from '@/lib/time';

export type CardAction = 'accept' | 'decline' | 'claim' | 'complete' | 'reopen';

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
  if (task.assignedTo === null) return `Up for grabs · from ${task.createdByName}`;
  const who = task.assignedTo === viewerId ? 'You' : task.assignedToName;
  if (task.createdBy === task.assignedTo) return `${who}`;
  return `${who} · from ${task.createdByName}`;
}
