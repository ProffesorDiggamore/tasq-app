/**
 * Client-safe half of the history module. The list renders in the browser, so
 * the types and the pure helpers it needs live here and lib/history.ts keeps
 * everything that touches the database.
 */
export type HistoryRange = 'today' | 'week' | 'month' | 'all';

export interface HistoryEntry {
  id: number;
  actorId: number | null;
  actorName: string | null;
  verb: string;
  subjectType: string;
  subjectId: number | null;
  summary: string;
  createdAt: number;
}

export interface HistoryDay {
  /** "YYYY-MM-DD" in shop time. */
  date: string;
  entries: HistoryEntry[];
}

export function isHistoryRange(value: string | undefined): value is HistoryRange {
  return value === 'today' || value === 'week' || value === 'month' || value === 'all';
}

/** Groups verbs into the handful of colours History uses. */
export function verbTone(verb: string): 'task' | 'supply' | 'people' | 'alert' {
  if (verb === 'auth.failed') return 'alert';
  if (verb.startsWith('supply.')) return 'supply';
  if (verb.startsWith('user.')) return 'people';
  return 'task';
}
