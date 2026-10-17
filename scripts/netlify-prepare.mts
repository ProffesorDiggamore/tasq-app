/**
 * Runs once per Netlify deploy, before `next build` (see netlify.toml):
 * brings the Turso database up to date and, while nobody has set the board up
 * yet, prints a fresh first-time setup code into the deploy log.
 *
 * This is the hosted stand-in for what instrumentation.ts does on every boot of
 * the shop Mac. Doing it per deploy rather than per cold start is the point —
 * serverless "boots" constantly, and each one would mint a code that cancels
 * the one the owner is about to type.
 *   npm run netlify:prepare
 */
if (!process.env.TURSO_DATABASE_URL) {
  console.error(
    '[tasq] TURSO_DATABASE_URL is not set. Add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in Netlify → Site configuration → Environment variables, then redeploy.',
  );
  process.exit(1);
}
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error(
    '[tasq] SESSION_SECRET is missing or shorter than 32 characters. Add it in Netlify → Site configuration → Environment variables, then redeploy.',
  );
  process.exit(1);
}

const { initDatabase } = await import('../lib/db/migrate');
await initDatabase();
console.log('[tasq] database is up to date.');
