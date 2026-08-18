import 'server-only';
import { spawnDueRecurrences } from '@/lib/recurrences';
import { markOverdueTasks } from '@/lib/overdue';

declare global {
  var __apexScheduler: NodeJS.Timeout | undefined;
}

const TICK_MS = 60_000;

/**
 * One in-process scheduler for the whole board. It ticks every minute and does
 * two things: spawn any recurrence that is due today and has not fired yet, and
 * nudge whoever owns a task that has just gone overdue.
 *
 * Both jobs are idempotent, which is what makes a once-a-minute poll safe. The
 * first tick runs immediately on boot so a machine that was asleep through a
 * spawn time catches up without waiting.
 */
export function startScheduler(): void {
  // Next reloads modules in development; without this every edit would leave
  // another live interval behind.
  if (globalThis.__apexScheduler) clearInterval(globalThis.__apexScheduler);

  const tick = () => {
    try {
      const report = spawnDueRecurrences();
      if (report.spawned > 0) {
        console.log(`[apex] spawned ${report.spawned} repeating task(s): ${report.titles.join(', ')}`);
      }
      void markOverdueTasks();
    } catch (error) {
      // A scheduler that dies on one bad tick takes the whole board's repeating
      // work with it, so this logs and lives to try again next minute.
      console.error('[apex] scheduler tick failed', error);
    }
  };

  tick();
  const timer = setInterval(tick, TICK_MS);
  // Never hold the process open on this alone.
  timer.unref?.();
  globalThis.__apexScheduler = timer;
}
