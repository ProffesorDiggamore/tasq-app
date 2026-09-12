/**
 * Fills a board with three people and ~90 days of finished work, so Analytics,
 * History and Payouts have real shapes in them.
 *
 *   TASQ_DB_PATH="$PWD/data/tasq.db" npm run seed:board
 *
 * Unlike seed-analytics-demo.mts this is meant to be pointed at a real board,
 * so it is careful about what it touches:
 *
 *   - An existing person is left exactly as they are. Nobody's PIN is reset.
 *   - Only people this script created get the placeholder PIN.
 *   - Existing tasks are left alone; the generated ones are added alongside.
 *
 * Pass --reset-devices to also empty the device list and turn the whitelist
 * off. Clearing the list on its own would lock every browser out until someone
 * ran `npm run devices` on the Mac holding the database, so the two go
 * together: approve the devices you want from the Devices tab, then turn the
 * whitelist back on there.
 */
const DB = process.env.TASQ_DB_PATH;
if (!DB) throw new Error('set TASQ_DB_PATH first');

const RESET_DEVICES = process.argv.includes('--reset-devices');

const { initDatabase } = await import('../lib/db/migrate');
const { db } = await import('../lib/db');
const { users, tasks, groups, devices, supplyRequests } = await import('../lib/db/schema');
const machine = await import('../lib/task-machine');
const payouts = await import('../lib/payouts');
const { setSetting } = await import('../lib/settings');
const { hashPin } = await import('../lib/auth/pin');
const { eq } = await import('drizzle-orm');

initDatabase();

const now = Date.now();
const DAY = 86_400_000;
const PIN = '1234';
const hash = await hashPin(PIN);

const CREW = [
  { name: 'Landon U', isAdmin: true },
  { name: 'Chris U', isAdmin: false },
  { name: 'Katie U', isAdmin: false },
];

const created: string[] = [];
const kept: string[] = [];

for (const person of CREW) {
  const exists = db.select().from(users).where(eq(users.name, person.name)).get();
  if (exists) {
    kept.push(person.name);
    continue;
  }
  db.insert(users)
    .values({
      name: person.name,
      isAdmin: person.isAdmin,
      isFounder: false,
      pinHash: hash,
      hasToured: true,
      createdAt: now - 120 * DAY,
    })
    .run();
  created.push(person.name);
}

const all = db.select().from(users).all();
const landon = all.find((u) => u.name === 'Landon U')!;
const chris = all.find((u) => u.name === 'Chris U')!;
const katie = all.find((u) => u.name === 'Katie U')!;

const TITLES = [
  'Sweep the bay',
  'Restock rags',
  'Wash the van',
  'Empty the traps',
  'Wipe the counter',
  'Log the hours',
  'Check tyre pressures',
  'Bin the offcuts',
  'Take the deposit in',
  'Vacuum the mats',
  'Pressure wash the forecourt',
  'Sort the returns',
];

// A rough working week: busy Mon-Fri, quiet at the weekend, sloping up over
// the last month so the delta chips on Analytics have something to say.
let seedRand = 7;
function rand(): number {
  seedRand = (seedRand * 1103515245 + 12345) % 2147483648;
  return seedRand / 2147483648;
}

let n = 0;
for (let daysAgo = 89; daysAgo >= 0; daysAgo -= 1) {
  const at = now - daysAgo * DAY;
  const weekday = new Date(at).getDay();
  const weekend = weekday === 0 || weekday === 6;
  const ramp = 1 + (90 - daysAgo) / 90;
  const count = Math.round((weekend ? 1 : 3) * ramp * (0.5 + rand()));

  for (let i = 0; i < count; i += 1) {
    // Landon takes a real share of the work, not just the posting of it —
    // otherwise the admin signs in and finds their own "Your work" panel at
    // zero while everyone else has a streak.
    const roll = rand();
    const who = roll < 0.4 ? chris : roll < 0.75 ? katie : landon;
    const reward = rand() < 0.16 ? [500, 1000, 1500, 2500][Math.floor(rand() * 4)] : null;
    const task = machine.createTask(
      landon,
      {
        title: TITLES[n % TITLES.length],
        notes: '',
        assignedTo: who.id,
        isAsap: rand() < 0.14,
        dueLocal: null,
        rewardCents: reward,
      },
      at - 3 * 3_600_000,
    );
    n += 1;
    if (!task.ok || task.taskId === undefined) continue;
    if (rand() < 0.2) machine.claimTask(who, task.taskId, at - 3_600_000);
    machine.completeTask(who, task.taskId, at);
    // Most bounties settled; a few left owing so Payouts has rows to show.
    if (reward !== null && rand() < 0.6) payouts.markTaskPaid(landon, task.taskId, at + 3_600_000);
  }
}

// A few still open, one of them overdue, so the board is not empty either.
machine.createTask(
  landon,
  { title: 'Order more polish', notes: '', assignedTo: null, isAsap: false, dueLocal: null, rewardCents: 1500 },
  now - 2 * DAY,
);
machine.createTask(
  landon,
  { title: 'Fix the bay light', notes: '', assignedTo: chris.id, isAsap: true, dueLocal: null, rewardCents: null },
  now - DAY,
);
machine.createTask(
  landon,
  { title: 'Vacuum the mats', notes: '', assignedTo: katie.id, isAsap: false, dueLocal: null, rewardCents: 500 },
  now - 4 * 3_600_000,
);
db.update(tasks)
  .set({ dueAt: now - 6 * 3_600_000 })
  .where(eq(tasks.title, 'Fix the bay light'))
  .run();

db.insert(supplyRequests)
  .values([
    { item: 'Blue roll', quantity: 'a case', requestedBy: chris.id, status: 'requested', createdAt: now - 2 * DAY },
    { item: 'Screenwash', quantity: '5L', requestedBy: katie.id, status: 'ordered', createdAt: now - 6 * DAY, orderedAt: now - 4 * DAY },
  ])
  .run();

if (RESET_DEVICES) {
  const gone = db.delete(devices).run();
  setSetting('whitelist.enabled', 'false');
  console.log(`cleared ${gone.changes} device(s); whitelist turned OFF so nobody is locked out.`);
  console.log('Approve the devices you want on the Devices tab, then turn it back on there.');
}

const done = db.select().from(tasks).all().filter((t) => t.status === 'done').length;
const open = db.select().from(tasks).all().filter((t) => t.status !== 'done' && t.status !== 'cancelled').length;
console.log(`\n${done} finished and ${open} open tasqs at ${DB}`);
if (created.length > 0) console.log(`added: ${created.join(', ')} — PIN ${PIN}`);
if (kept.length > 0) console.log(`already there, untouched (PIN unchanged): ${kept.join(', ')}`);
