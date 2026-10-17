import 'server-only';
import fs from 'node:fs';
import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';
import { DATA_DIR, DB_PATH } from '@/lib/paths';

/**
 * Where the board's data lives.
 *
 * Hosted (Netlify), there is no disk that survives between requests, so the data
 * is a Turso database reached over the network: TURSO_DATABASE_URL and
 * TURSO_AUTH_TOKEN, set in Netlify's environment variables. Anywhere else — the
 * shop Mac, `npm run dev`, every verify script — it is the same SQLite file it
 * always was, opened through the same client, so there is one code path.
 */
export const REMOTE_DATABASE_URL = process.env.TURSO_DATABASE_URL?.trim() || null;

declare global {
  // Reused across Next's dev-mode module reloads so we never open the file twice.
  var __tasqClient: Client | undefined;
}

function openClient(): Client {
  if (REMOTE_DATABASE_URL) {
    return createClient({ url: REMOTE_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  // One connection, as before: the PRAGMAs below are per connection, and a pool
  // would hand later statements a connection that never received them.
  // `timeout` is SQLite's busy_timeout, set as the connection opens — before
  // anything that can contend, which is where it has to be.
  const client = createClient({ url: `file:${DB_PATH}`, concurrency: 1, timeout: 5000 });

  // WAL keeps readers from blocking the writer. It is a property of the file,
  // so once any process has switched it, it stays switched; a fresh install
  // whose build workers race for the switch loses nothing by one of them
  // failing — the file works in either journal mode.
  void client.execute('PRAGMA journal_mode = WAL').catch(() => undefined);
  void client.execute('PRAGMA synchronous = NORMAL').catch(() => undefined);
  void client.execute('PRAGMA foreign_keys = ON').catch(() => undefined);
  return client;
}

export const client: Client = globalThis.__tasqClient ?? openClient();
if (process.env.NODE_ENV !== 'production') globalThis.__tasqClient = client;

export const db = drizzle(client, { schema });
export { schema };
