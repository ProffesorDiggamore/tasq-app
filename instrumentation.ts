/**
 * Next calls register() once per server start, before the first request. This
 * is where the database is brought up to date, the first setup code is minted,
 * and the recurrence scheduler starts — so a reboot needs nobody to log in and
 * click anything.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { initDatabase } = await import('@/lib/db/migrate');
  initDatabase();
  const { startScheduler } = await import('@/lib/scheduler');
  startScheduler();
}
