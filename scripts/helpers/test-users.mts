/**
 * Test fixture for the verify scripts. A production install starts empty and
 * is activated through a setup code at /setup — the app itself never seeds
 * people. These five exist so the scripts have a crew to exercise.
 */
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db';
import { users } from '../../lib/db/schema';

const TEST_USERS: ReadonlyArray<{ name: string; isAdmin: boolean }> = [
  { name: 'Chris', isAdmin: true },
  { name: 'Landon', isAdmin: false },
  { name: 'Tony', isAdmin: false },
  { name: 'Shelly', isAdmin: false },
  { name: 'Alyssa', isAdmin: false },
];

export function seedTestUsers(): void {
  const now = Date.now();
  // Per-row so a script that already created someone (verify-auth redeems a
  // setup code into Chris first) just tops up the missing crew.
  for (const u of TEST_USERS) {
    const exists = db.select({ id: users.id }).from(users).where(eq(users.name, u.name)).get();
    if (exists) continue;
    db.insert(users)
      .values({ name: u.name, isAdmin: u.isAdmin, createdAt: now })
      .onConflictDoNothing()
      .run();
  }
}
