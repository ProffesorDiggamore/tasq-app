import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { appSettings } from '@/lib/db/schema';

/** The name shown before the business picks its own during setup. */
export const DEFAULT_ORG_NAME = 'Tasq Board';

export function getSetting(key: string): string | null {
  const row = db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .get();
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.insert(appSettings)
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
export function setSettingIfAbsent(key: string, value: string): string {
  db.insert(appSettings)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoNothing()
    .run();
  return getSetting(key) ?? value;
}

/**
 * The business name, wherever the UI says who this board belongs to. A name
 * chosen during setup or changed in Settings wins; TASQ_ORG_NAME stands in
 * before that — useful when shipping a box pre-labelled for a customer.
 */
export function getOrgName(): string {
  return getSetting('org.name') ?? process.env.TASQ_ORG_NAME?.trim() ?? DEFAULT_ORG_NAME;
}
