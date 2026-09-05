/**
 * Seeds a throwaway board with a few weeks of finished work so the Analytics
 * screen can be looked at with real shapes in it. Never points at data/tasq.db.
 */
const DB = process.env.TASQ_DB_PATH;
if (!DB) throw new Error('set TASQ_DB_PATH first');

const { initDatabase } = await import('../lib/db/migrate');
const { db } = await import('../lib/db');
const { users, tasks, groups, groupMembers, supplyRequests } = await import('../lib/db/schema');
const machine = await import('../lib/task-machine');
const payouts = await import('../lib/payouts');
const { hashPin } = await import('../lib/auth/pin');
const { eq } = await import('drizzle-orm');

initDatabase();

const now = Date.now();
const DAY = 86_400_000;
const PIN = '1234';
const hash = await hashPin(PIN);

const CREW = [
  { name: 'Chris', isAdmin: true },
  { name: 'Tony', isAdmin: false },
  { name: 'Shelly', isAdmin: false },
  { name: 'Alyssa', isAdmin: false },
];

for (const person of CREW) {
  const exists = db.select().from(users).where(eq(users.name, person.name)).get();
  if (!exists) {
    db.insert(users)
      .values({
        name: person.name,
        isAdmin: person.isAdmin,
        isFounder: person.isAdmin,
        pinHash: hash,
        hasToured: true,
        createdAt: now - 120 * DAY,
      })
      .run();
  }
}

const all = db.select().from(users).all();
const chris = all.find((u) => u.name === 'Chris')!;
const tony = all.find((u) => u.name === 'Tony')!;
const shelly = all.find((u) => u.name === 'Shelly')!;
const alyssa = all.find((u) => u.name === 'Alyssa')!;

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
];

// A rough working week: busy Mon-Fri, quiet at the weekend, and a slope up
// over the last month so the delta chips have something to say.
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
  const ramp = 1 + (90 - daysAgo) / 90; // busier lately
  const count = Math.round((weekend ? 1 : 3) * ramp * (0.5 + rand()));

  for (let i = 0; i < count; i += 1) {
    const who = rand() < 0.45 ? tony : rand() < 0.6 ? shelly : alyssa;
    const reward = rand() < 0.16 ? [500, 1000, 1500, 2500][Math.floor(rand() * 4)] : null;
    const created = machine.createTask(
      chris,
      {
        title: `${TITLES[n % TITLES.length]}`,
        notes: '',
        assignedTo: who.id,
        isAsap: rand() < 0.14,
        dueLocal: null,
        rewardCents: reward,
      },
      at - 3 * 3_600_000,
    );
    n += 1;
    if (!created.ok || created.taskId === undefined) continue;
    if (rand() < 0.2) machine.claimTask(who, created.taskId, at - 3_600_000);
    machine.completeTask(who, created.taskId, at);
    // Most bounties are settled; a few are left owing so Payouts has rows.
    if (reward !== null && rand() < 0.6) payouts.markTaskPaid(chris, created.taskId, at + 3_600_000);
  }
}

// A handful still open, one of them overdue.
machine.createTask(
  chris,
  { title: 'Order more polish', notes: '', assignedTo: null, isAsap: false, dueLocal: null, rewardCents: 1500 },
  now - 2 * DAY,
);
machine.createTask(
  chris,
  { title: 'Fix the bay light', notes: '', assignedTo: tony.id, isAsap: true, dueLocal: null, rewardCents: null },
  now - DAY,
);
db.update(tasks)
  .set({ dueAt: now - 6 * 3_600_000 })
  .where(eq(tasks.title, 'Fix the bay light'))
  .run();

db.insert(supplyRequests)
  .values([
    { item: 'Blue roll', quantity: 'a case', requestedBy: tony.id, status: 'requested', createdAt: now - 2 * DAY },
    { item: 'Screenwash', quantity: '5L', requestedBy: shelly.id, status: 'ordered', createdAt: now - 6 * DAY, orderedAt: now - 4 * DAY },
  ])
  .run();

const done = db.select().from(tasks).all().filter((t) => t.status === 'done').length;
console.log(`seeded ${done} finished tasqs across ${all.length} people at ${DB}`);
console.log(`sign in as Chris (admin) or Tony / Shelly / Alyssa (crew), PIN ${PIN}`);
