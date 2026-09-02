/**
 * The way back in.
 *
 * The device whitelist is enforced by the app, so an owner who revokes their
 * last approved browser has no way to approve a new one from the web. This runs
 * on the machine that holds the database, which is a stronger claim of
 * ownership than any button in the UI could be.
 *
 *   npm run devices                 list every device and its status
 *   npm run devices -- approve 3    let device #3 in
 *   npm run devices -- approve all  let every waiting device in
 *   npm run devices -- off          turn the whitelist off entirely
 */
import { eq } from 'drizzle-orm';
import { initDatabase } from '../lib/db/migrate';
import { db } from '../lib/db';
import { devices } from '../lib/db/schema';
import { setSetting } from '../lib/settings';

initDatabase();

const [command, target] = process.argv.slice(2);
const now = Date.now();

function list(): void {
  const rows = db.select().from(devices).all();
  if (rows.length === 0) {
    console.log('No devices have ever reached this board.');
    return;
  }
  console.log('  #   status     last seen             name');
  for (const d of rows) {
    console.log(
      `  ${String(d.id).padEnd(3)} ${d.status.padEnd(9)}  ${new Date(d.lastSeenAt)
        .toISOString()
        .slice(0, 16)
        .replace('T', ' ')}      ${d.label}`,
    );
  }
}

if (!command || command === 'list') {
  list();
} else if (command === 'off') {
  setSetting('whitelist.enabled', 'false');
  console.log('Whitelist off. Anyone who can reach the address can reach the sign-in screen.');
} else if (command === 'approve' && target === 'all') {
  const result = db
    .update(devices)
    .set({ status: 'approved', approvedAt: now })
    .where(eq(devices.status, 'pending'))
    .run();
  console.log(`Approved ${result.changes} waiting device(s).`);
  list();
} else if (command === 'approve' && /^\d+$/.test(target ?? '')) {
  const id = Number(target);
  const result = db
    .update(devices)
    .set({ status: 'approved', approvedAt: now })
    .where(eq(devices.id, id))
    .run();
  console.log(result.changes === 0 ? `No device #${id}.` : `Approved device #${id}.`);
  list();
} else {
  console.log('Usage: npm run devices [list | approve <id> | approve all | off]');
  process.exit(1);
}
