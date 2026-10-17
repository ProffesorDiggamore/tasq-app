import 'server-only';
import { spawnDueRecurrences } from '@/lib/recurrences';
import { markOverdueTasks } from '@/lib/overdue';
import { pruneHistory } from '@/lib/history';

declare global {
  var __tasqScheduler: NodeJS.Timeout | undefined;
}

const TICK_MS = 60_000;

export interface TickReport {
  spawned: number;
  overdue: number;
}

/**
 * The board's periodic work: spawn any recurrence that is due today and has not
 * fired yet, nudge whoever owns a task that has just gone overdue, and prune old
 * history. Every part is idempotent, which is what makes running it on a timer
 * safe however often or late the timer fires.
 *
 * Two things drive it. On the shop Mac it is an in-process interval (below).
 * Hosted on Netlify there is no process that stays up, so a scheduled function
 * (netlify/functions/tick.mts) calls /api/cron/tick, which runs this.
 */
export async function runTick(now: number = Date.now()): Promise<TickReport> {
  const report = await spawnDueRecurrences(now);
  if (report.spawned > 0) {
    console.log(`[tasq] spawned ${report.spawned} repeating tasq(s): ${report.titles.join(', ')}`);
  }
  const overdue = await markOverdueTasks(now);
  // Self-gated to once an hour internally; every tick is just a timestamp check.
  await pruneHistory(now);
  return { spawned: report.spawned, overdue: overdue.length };
}

/**
 * The in-process driver, for a board that runs as one long-lived server. It
 * ticks every minute; the first tick runs immediately on boot so a machine that
 * was asleep through a spawn time catches up without waiting.
 */
export function startScheduler(): void {
  // Next reloads modules in development; without this every edit would leave
  // another live interval behind.
  if (globalThis.__tasqScheduler) clearInterval(globalThis.__tasqScheduler);

  const tick = () => {
    // A scheduler that dies on one bad tick takes the whole board's repeating
    // work with it, so this logs and lives to try again next minute.
    runTick().catch((error) => console.error('[tasq] scheduler tick failed', error));
  };

  tick();
  const timer = setInterval(tick, TICK_MS);
  // Never hold the process open on this alone.
  timer.unref?.();
  globalThis.__tasqScheduler = timer;
}
