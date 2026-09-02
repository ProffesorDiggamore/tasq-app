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

/**
 * Server-error hook. Its whole job here is to make a deliberate `TasqError`
 * legible in the log: one line, `[tasq] TASQ-E0102: Only an admin can do that.`,
 * so a shop owner can read the code out and support can look it up in
 * ERROR-CODES.md. Anything that is not a TasqError is a real bug — left alone
 * so Next's own stack trace still prints.
 */
export async function onRequestError(err: unknown): Promise<void> {
  const { isTasqError, formatTasqLogLine } = await import('@/lib/errors');
  const candidate =
    isTasqError(err) ? err : isTasqError((err as { cause?: unknown })?.cause) ? (err as { cause: unknown }).cause : null;
  if (candidate && isTasqError(candidate)) {
    console.error(formatTasqLogLine(candidate));
  }
}
