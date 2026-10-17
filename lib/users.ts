import 'server-only';
import { asc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users, type User } from '@/lib/db/schema';
import type { PersonSummary } from '@/lib/auth/results';

/** Everyone still on the crew, in a stable order so the picker never reshuffles. */
export async function listActiveUsers(): Promise<User[]> {
  return await db
    .select()
    .from(users)
    .where(isNull(users.archivedAt))
    .orderBy(asc(users.id))
    .all();
}

export async function listAllUsers(): Promise<User[]> {
  return await db.select().from(users).orderBy(asc(users.id)).all();
}

export async function getUser(id: number): Promise<User | undefined> {
  return await db.select().from(users).where(eq(users.id, id)).get();
}

/** The picker only needs to know who exists and whether they have a PIN yet. */
export function toPersonSummary(user: User): PersonSummary {
  return {
    id: user.id,
    name: user.name,
    isAdmin: user.isAdmin,
    enrolled: user.pinHash !== null,
  };
}
