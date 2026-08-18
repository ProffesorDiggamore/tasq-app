import 'server-only';
import { db } from '@/lib/db';
import { activityLog } from '@/lib/db/schema';

export type ActivityVerb =
  | 'task.created'
  | 'task.assigned'
  | 'task.accepted'
  | 'task.declined'
  | 'task.claimed'
  | 'task.completed'
  | 'task.reopened'
  | 'task.cancelled'
  | 'supply.created'
  | 'supply.ordered'
  | 'supply.received'
  | 'user.pin_enrolled'
  | 'user.pin_reset'
  | 'user.created'
  | 'user.updated'
  | 'user.archived'
  | 'auth.failed';

export type SubjectType = 'task' | 'supply_request' | 'user' | 'recurrence';

export interface LogEntry {
  /** Null when the scheduler, not a person, caused the event. */
  actorId: number | null;
  verb: ActivityVerb;
  subjectType: SubjectType;
  subjectId: number | null;
  /**
   * Written as finished prose at write time — History must be readable years
   * later without joining back to rows that may have been renamed since.
   */
  summary: string;
}

/** Append-only. There is deliberately no update or delete counterpart. */
export function logActivity(entry: LogEntry, now: number = Date.now()): void {
  db.insert(activityLog)
    .values({
      actorId: entry.actorId,
      verb: entry.verb,
      subjectType: entry.subjectType,
      subjectId: entry.subjectId,
      summary: entry.summary,
      createdAt: now,
    })
    .run();
}
