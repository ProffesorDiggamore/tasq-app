import 'server-only';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { DATA_DIR, DB_PATH } from '@/lib/paths';

declare global {
  // Reused across Next's dev-mode module reloads so we never open the file twice.
  var __apexSqlite: Database.Database | undefined;
}

function openDatabase(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const conn = new Database(DB_PATH);

  // busy_timeout goes FIRST, before anything that can contend.
  //
  // Switching a brand-new database into WAL needs an exclusive lock, and a
  // production build collects page data in a worker per core — on a fresh
  // install they all create the file and race for that lock at once, and
  // whichever loses dies with SQLITE_BUSY and fails the build. With the timeout
  // already in place they queue instead. Setting it afterwards is too late: the
  // statement that needs it has already run.
  conn.pragma('busy_timeout = 5000');

  // WAL keeps readers from blocking the writer — five people on phones plus the
  // scheduler all touch this file, and the nightly backup reads it live.
  conn.pragma('journal_mode = WAL');
  conn.pragma('synchronous = NORMAL');
  conn.pragma('foreign_keys = ON');
  return conn;
}

export const sqlite: Database.Database = globalThis.__apexSqlite ?? openDatabase();
if (process.env.NODE_ENV !== 'production') globalThis.__apexSqlite = sqlite;

export const db = drizzle(sqlite, { schema });
export { schema };
