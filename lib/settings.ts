import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { appSettings } from '@/lib/db/schema';

/**
 * The product name, everywhere the UI says who this board belongs to: the
 * header, the browser tab, the home-screen install, the footer.
 *
 * This used to be a per-board setting a shop could rename itself to. It is a
 * constant now on purpose — a board calling itself "Gold Standard Detailing"
 * on one phone and "Tasq" on another (manifest caches, an install made before
 * the rename) is worse than no choice at all, and every support conversation
 * starts with working out what the customer's board is even called.
 */
export const ORG_NAME = 'Tasq';

export async function getSetting(key: string): Promise<string | null> {
  const row = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .get();
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.insert(appSettings)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: Date.now() },
    })
    .run();
}

/**
 * Sets the key only when it does not exist yet, then returns whatever is
 * stored. Two server actions racing to generate a secret both run this; one
 * wins and both read back the winner, so secrets never flip-flop.
 */
export async function setSettingIfAbsent(key: string, value: string): Promise<string> {
  await db.insert(appSettings)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoNothing()
    .run();
  return await getSetting(key) ?? value;
}

/**
 * Kept as a function rather than exporting the constant at every call site, so
 * the many `getOrgName()` calls across the app did not all have to change and
 * a future per-board name has one place to come back to.
 */
export function getOrgName(): string {
  return ORG_NAME;
}
