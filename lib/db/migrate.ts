import 'server-only';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './index';
import { MIGRATIONS_DIR } from '@/lib/paths';
import { ensureSetupCode } from '@/lib/setup';

let done = false;

/**
 * Runs on server start (see instrumentation.ts). Applying migrations and
 * minting the first setup code are both idempotent, so a crash-restart loop is
 * harmless. A fresh install starts with zero people: the owner redeems the
 * setup code at /setup to create the first admin account.
 */
export function initDatabase(): void {
  if (done) return;
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  ensureSetupCode();
  done = true;
}
