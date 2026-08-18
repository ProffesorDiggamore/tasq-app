/**
 * Next calls register() once per server start, before the first request. This
 * is where the database is brought up to date and the shop's people are seeded,
 * so a reboot needs nobody to log in and click anything.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { migrateAndSeed } = await import('@/lib/db/migrate');
  migrateAndSeed();
}
