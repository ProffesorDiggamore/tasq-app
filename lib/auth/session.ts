import 'server-only';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users, type User } from '@/lib/db/schema';
import { TasqError } from '@/lib/errors';
import { sessionOptions, type SessionData } from '@/lib/auth/session.config';

export {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  SESSION_REFRESH_AFTER_MS,
  sessionOptions,
  type SessionData,
} from '@/lib/auth/session.config';

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

/** Instant switch — no logout ceremony, per the shared-iPad requirement. */
export async function signIn(userId: number): Promise<void> {
  const session = await getSession();
  session.userId = userId;
  session.issuedAt = Date.now();
  await session.save();
}

export async function signOut(): Promise<void> {
  const session = await getSession();
  session.destroy();
}

/** The signed-in person, or null. Archived people are treated as signed out. */
export async function currentUser(): Promise<User | null> {
  const session = await getSession();
  if (!session.userId) return null;
  const user = db.select().from(users).where(eq(users.id, session.userId)).get();
  if (!user || user.archivedAt !== null) return null;
  return user;
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new TasqError('TASQ-E0101');
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (!user.isAdmin) throw new TasqError('TASQ-E0102');
  return user;
}
