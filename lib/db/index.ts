import 'server-only';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { DATA_DIR, DB_PATH } from '@/lib/paths';

declare global {
  // Reused across Next's dev-mode module reloads so we never open the file twice.
  var __tasqSqlite: Database.Database | undefined;
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
  //
  // Switching into WAL needs a brief exclusive lock and, unlike ordinary
  // statements, SQLite can hand back SQLITE_BUSY for the pragma itself without
  // honouring busy_timeout when several fresh connections race to create the
  // file (a production build collects page data one worker per core). Retry
  // instead: whoever loses waits and tries again, and every attempt is
  // idempotent once the file is already in WAL.
  for (let attempt = 0; ; attempt += 1) {
    const mode = conn.pragma('journal_mode = WAL', { simple: true });
    if (mode === 'wal') break;
    if (attempt >= 40) {
      throw new Error(`Could not switch ${DB_PATH} into WAL mode (last mode: ${mode})`);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  conn.pragma('synchronous = NORMAL');
  conn.pragma('foreign_keys = ON');
  return conn;
}

export const sqlite: Database.Database = globalThis.__tasqSqlite ?? openDatabase();
if (process.env.NODE_ENV !== 'production') globalThis.__tasqSqlite = sqlite;

export const db = drizzle(sqlite, { schema });
export { schema };
