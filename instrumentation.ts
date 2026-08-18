/**
 * Next calls register() once per server start, before the first request. This
 * is where the database is brought up to date, the shop's people are seeded, and
 * the recurrence scheduler starts — so a reboot needs nobody to log in and click
 * anything.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { migrateAndSeed } = await import('@/lib/db/migrate');
  migrateAndSeed();
  const { startScheduler } = await import('@/lib/scheduler');
  startScheduler();
}
