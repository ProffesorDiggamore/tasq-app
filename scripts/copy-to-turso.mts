/**
 * One-time move of the shop Mac's board into Turso, so going hosted keeps every
 * person, PIN, tasq, photo and history entry.
 *
 *   TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… npm run copy-to-turso
 *
 * Copies data/tasq.db (or TASQ_DB_PATH) — schema, rows, and the record of which
 * migrations have run — into the Turso database, in one transaction: it lands
 * whole or not at all. Run it before the first Netlify deploy, or after one that
 * has not been set up yet; it refuses to touch a Turso board that already has
 * people on it, so it can never overwrite a live hosted board.
 */
import { createClient, type InStatement } from '@libsql/client';
import { DB_PATH } from '../lib/paths';

const url = process.env.TURSO_DATABASE_URL?.trim();
const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
if (!url || !authToken) {
  console.error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN first (both are on the Turso dashboard).');
  process.exit(1);
}

const source = createClient({ url: `file:${DB_PATH}` });
const target = createClient({ url, authToken });

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

const schema = await source.execute(
  "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
);
const tables = schema.rows.filter((r) => r.type === 'table').map((r) => String(r.name));
if (!tables.includes('users')) {
  console.error(`${DB_PATH} does not look like a Tasq board (no users table).`);
  process.exit(1);
}

// What is already in Turso. A deploy that ran before this script leaves the
// schema and an unused setup code behind; that is fine to replace. People are not.
const existing = (
  await target.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' AND name NOT LIKE '_litestream%'")
).rows.map((r) => String(r.name));
if (existing.includes('users')) {
  const people = Number((await target.execute('SELECT count(*) FROM users')).rows[0][0]);
  if (people > 0) {
    console.error(`The Turso board already has ${people} people on it — refusing to overwrite it.`);
    process.exit(1);
  }
}

const statements: InStatement[] = ['PRAGMA defer_foreign_keys = ON'];
for (const name of existing) statements.push(`DROP TABLE IF EXISTS ${quote(name)}`);

// Every table before any row: a child table's insert needs its parent table to
// exist even with the key checks deferred, and sqlite_master order is creation
// order, which table rebuilds in later migrations have shuffled.
const tableRows = schema.rows.filter((r) => r.type === 'table');
for (const row of tableRows) statements.push(String(row.sql));

// References to rows deleted long ago — a history entry whose person is gone.
// The Mac let them stand; the copy's key check would refuse the whole batch.
// A nullable reference is cleared (the entry stays, its prose still says who);
// a row that cannot exist without its parent is left behind.
const orphans = new Map<string, Map<number, string[] | 'drop'>>();
for (const o of (await source.execute('PRAGMA foreign_key_check')).rows) {
  const [table, rowid, fkid] = [String(o[0]), Number(o[1]), Number(o[3])];
  const fks = (await source.execute(`PRAGMA foreign_key_list(${quote(table)})`)).rows;
  const cols = fks.filter((f) => Number(f.id) === fkid).map((f) => String(f.from));
  const info = (await source.execute(`PRAGMA table_info(${quote(table)})`)).rows;
  const nullable = cols.every((c) => {
    const col = info.find((i) => i.name === c);
    return col !== undefined && Number(col.notnull) === 0 && Number(col.pk) === 0;
  });
  const perTable = orphans.get(table) ?? new Map<number, string[] | 'drop'>();
  const before = perTable.get(rowid);
  perTable.set(rowid, !nullable || before === 'drop' ? 'drop' : [...(before ?? []), ...cols]);
  orphans.set(table, perTable);
}
let cleared = 0;
let dropped = 0;

let rowCount = 0;
for (const row of tableRows) {
  const name = String(row.name);
  // A push subscription belongs to the address the phone installed the board
  // from — the Mac's. Notifications sent through it would open that dead
  // address, so everyone turns notifications on again from the new one.
  if (name === 'push_subscriptions') continue;
  const data = await source.execute(`SELECT rowid AS __rowid, * FROM ${quote(name)}`);
  if (data.rows.length === 0) continue;
  const columns = data.columns.slice(1);
  const cols = columns.map(quote).join(', ');
  const marks = columns.map(() => '?').join(', ');
  const fixes = orphans.get(name);
  for (const r of data.rows) {
    const args = Array.from(r).slice(1);
    const fix = fixes?.get(Number(r[0]));
    if (fix === 'drop') {
      dropped += 1;
      continue;
    }
    if (fix) {
      for (const c of fix) args[columns.indexOf(c)] = null;
      cleared += 1;
    }
    statements.push({ sql: `INSERT INTO ${quote(name)} (${cols}) VALUES (${marks})`, args });
    rowCount += 1;
  }
}
if (cleared + dropped > 0) {
  console.log(
    `Tidied ${cleared + dropped} row(s) pointing at people deleted earlier: ${cleared} kept with the reference cleared, ${dropped} left behind.`,
  );
}
// Indexes and triggers after the rows, so they are built once.
for (const row of schema.rows.filter((r) => r.type === 'index' || r.type === 'trigger')) {
  statements.push(String(row.sql));
}
// Device approvals are cookies on the old address; at the new one every phone is
// a stranger. Left on, the whitelist would lock the whole crew out.
statements.push("UPDATE app_settings SET value = 'false' WHERE key = 'whitelist.enabled'");

console.log(`Copying ${tables.length} tables and ${rowCount} rows from ${DB_PATH} into Turso…`);
await target.batch(statements, 'write');

const people = Number((await target.execute('SELECT count(*) FROM users')).rows[0][0]);
const tasqs = Number((await target.execute('SELECT count(*) FROM tasks')).rows[0][0]);
console.log(`Done. Turso now has ${people} people and ${tasqs} tasqs.`);
console.log('Notifications start off on the new address — each person turns them on again in Settings.');
console.log('"Approved devices only" was switched off; turn it back on in Devices once everyone is in.');
source.close();
target.close();
