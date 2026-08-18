import 'server-only';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { db, sqlite } from './index';
import { users } from './schema';
import { MIGRATIONS_DIR } from '@/lib/paths';

/** The five people the shop starts with. Editable afterwards in Settings. */
const SEED_USERS: ReadonlyArray<{ name: string; isAdmin: boolean }> = [
  { name: 'Chris', isAdmin: true },
  { name: 'Landon', isAdmin: false },
  { name: 'Tony', isAdmin: false },
  { name: 'Shelly', isAdmin: false },
  { name: 'Alyssa', isAdmin: false },
];

let done = false;

/**
 * Runs on server start (see instrumentation.ts). Applying migrations and
 * seeding are both idempotent, so a crash-restart loop is harmless.
 */
export function migrateAndSeed(): void {
  if (done) return;
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });

  const existing = db.select({ name: users.name }).from(users).all();
  if (existing.length === 0) {
    const now = Date.now();
    const insert = db.insert(users).values(
      SEED_USERS.map((u) => ({
        name: u.name,
        isAdmin: u.isAdmin,
        createdAt: now,
      })),
    );
    insert.run();
  }
  done = true;
}

/** Used by the CLI seed script and tests; not part of the request path. */
export function ensureUser(name: string, isAdmin: boolean): void {
  const found = db.select().from(users).where(eq(users.name, name)).get();
  if (!found) {
    db.insert(users).values({ name, isAdmin, createdAt: Date.now() }).run();
  }
}

export { sqlite };
