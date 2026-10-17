import { money } from '@/lib/money';
import { formatShort } from '@/lib/time';
import type { NotifyEventKey } from '@/lib/notify-events';

/**
 * What a phone actually shows, in three parts, decided in one place.
 *
 * A notification has exactly two lines we control — the OS owns the rest, which
 * is where the board's own name comes from — so they are spent deliberately:
 *
 *   You Have A New Tasq!        the heading: which of these it is, read at arm's length
 *   Grease the skid steer       what it is about
 *   $25                         the one detail worth waking a phone for
 *
 * The third line is chosen by what the task is actually offering: the money if
 * there is any, otherwise when it is due, otherwise whatever the note said, and
 * otherwise nothing — a blank line beats padding it out with something the
 * person already knows.
 */
export const NOTIFY_HEADLINE: Record<NotifyEventKey, string> = {
  'task.assigned': 'You Have A New Tasq!',
  'task.self-assigned': 'You Added A Tasq!',
  'task.asap': 'There Is An ASAP Tasq!',
  'task.accepted': 'A Tasq Was Accepted!',
  'task.claimed': 'A Tasq Was Grabbed!',
  'task.declined': 'A Tasq Came Back!',
  'task.completed': 'A Tasq Was Done!',
  'task.overdue': 'A Tasq Is Overdue!',
  'supply.requested': 'Someone Needs A Supply!',
  'supply.moved': 'Supply Update!',
};

/** An ASAP handed to one person is about them, not about the shop. */
export const ASAP_FOR_YOU_HEADLINE = 'You Have An ASAP Tasq!';
export const ANNOUNCEMENT_HEADLINE = 'There Is An Announcement!';
export const SUPPLY_ORDERED_HEADLINE = 'Your Supply Is On Order!';
export const SUPPLY_ARRIVED_HEADLINE = 'Your Supply Arrived!';

/** A note can be a paragraph; a notification line cannot. */
const NOTE_MAX = 80;

function firstLine(notes: string): string {
  const line = notes.trim().split('\n')[0].trim();
  return line.length > NOTE_MAX ? `${line.slice(0, NOTE_MAX - 1).trimEnd()}…` : line;
}

export interface TaskDetailSource {
  rewardCents: number | null;
  dueAt: number | null;
  notes: string | null;
}

/** Money, then the deadline, then the note, then nothing. */
export function taskDetail(task: TaskDetailSource): string | null {
  if (task.rewardCents) return money(task.rewardCents);
  if (task.dueAt) return `Due ${formatShort(task.dueAt)}`;
  const notes = task.notes?.trim();
  return notes ? firstLine(notes) : null;
}

/**
 * For the admin's line about someone else's tap, where who did it is the whole
 * point of the notification — and the bounty is what it cost the board.
 */
export function personDetail(name: string, rewardCents: number | null): string {
  return rewardCents ? `${money(rewardCents)} by ${name}` : `by ${name}`;
}

/** Subject on its own line, detail under it when there is one. */
export function notifyBody(subject: string, detail: string | null): string {
  return detail ? `${subject}\n${detail}` : subject;
}
