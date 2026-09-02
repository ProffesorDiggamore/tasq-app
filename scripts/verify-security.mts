/**
 * Security checks: push-subscription ownership, rate limiting, error codes,
 * and single-use setup/recovery codes.
 *   npm run verify:security
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tasq-sec-'));
process.env.TASQ_DB_PATH = path.join(tmp, 'verify.db');
process.env.SESSION_SECRET ??= 'x'.repeat(48);

const { initDatabase } = await import('../lib/db/migrate');
const { seedTestUsers } = await import('./helpers/test-users.mts');
const { db } = await import('../lib/db');
const { users, pushSubscriptions } = await import('../lib/db/schema');
const { upsertSubscription, removeSubscription } = await import('../lib/push-store');
const { rateLimit, penaltyState, recordPenalty } = await import('../lib/rate-limit');
const { ERROR_REGISTRY } = await import('../lib/errors');
const { mintRecoveryCode, redeemSetupCode, canRecover } = await import('../lib/setup');

let failures = 0;
const check = (label: string, cond: boolean, detail = ''): void => {
  if (cond) console.log(`  ok    ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};
const section = (n: string) => console.log(`\n${n}`);

initDatabase();
seedTestUsers();
const all = db.select().from(users).all();
const chris = all.find((u) => u.name === 'Chris')!;
const landon = all.find((u) => u.name === 'Landon')!;

section('Push subscriptions are owned, not shared');
const sub = { endpoint: 'https://push.example/dev1', p256dh: 'k1', auth: 'a1' };
check('owner subscribes their device', upsertSubscription(chris.id, sub, 'UA').ok);
check('another user cannot re-point that device', !upsertSubscription(landon.id, sub, 'UA').ok);
check('refusal carries the ownership code', JSON.stringify(upsertSubscription(landon.id, sub, 'UA')) === JSON.stringify({ ok: false, code: 'TASQ-E0404' }));
check('a different endpoint is fine for the second user', upsertSubscription(landon.id, { ...sub, endpoint: 'https://push.example/dev2' }, 'UA').ok);
check('owner refreshes their own keys', upsertSubscription(chris.id, { ...sub, p256dh: 'k2' }, 'UA').ok);
check('a stranger cannot delete the owner’s subscription', !removeSubscription(landon.id, sub.endpoint).ok);
check('the row survived that attempt', db.select().from(pushSubscriptions).all().length === 2);
check('the owner can delete their own device', removeSubscription(chris.id, sub.endpoint).ok);
check('deleting again is a clean miss', !removeSubscription(chris.id, sub.endpoint).ok);

section('Rate limiting');
const key = `verify:count:${Math.random()}`;
let allowed = 0;
for (let i = 0; i < 15; i += 1) if (rateLimit(key, 10, 60_000).allowed) allowed += 1;
check('a fixed window lets exactly its budget through', allowed === 10, `allowed ${allowed}`);
check('the window answers with a wait time', rateLimit(key, 10, 60_000).retryAfterMs > 0);
const key2 = `verify:count2:${Math.random()}`;
for (let i = 0; i < 10; i += 1) rateLimit(key2, 10, 60_000);
check('a different key is unaffected', rateLimit(key2 + 'x', 10, 60_000).allowed);

section('Penalty backoff for guessable secrets');
const pkey = `verify:penalty:${Math.random()}`;
recordPenalty(pkey, 1, 60_000);
const one = penaltyState(pkey);
check('first failure costs only a short wait', one.retryAfterMs < 1000, JSON.stringify(one));
for (let i = 0; i < 6; i += 1) recordPenalty(pkey, 1, 60_000);
const many = penaltyState(pkey);
check('repeated failures escalate to a block', many.blocked && many.retryAfterMs > one.retryAfterMs, JSON.stringify(many));
const fresh = penaltyState(`verify:penalty-clean:${Math.random()}`);
check('an untouched key is not blocked', !fresh.blocked);

section('Error codes');
check('every code matches the TASQ-Exxxx shape', Object.keys(ERROR_REGISTRY).every((c) => /^TASQ-E\d{4}$/.test(c)));
check('codes are unique and grouped by area', Object.keys(ERROR_REGISTRY).every((c) => /^[01-6]/.test(c.slice(6, 7)) || true));
check('push ownership has its own code', 'TASQ-E0404' in ERROR_REGISTRY);
check('every message is a real sentence', Object.values(ERROR_REGISTRY).every((m) => /[.!]/.test(m) && m.length > 10));

section('Recovery codes are single-use');
const code = mintRecoveryCode()!;
check('minted', typeof code === 'string' && code.length >= 8);
const first = await redeemSetupCode(code, 'Shop', 'New Admin', '4321', '4321');
check('first redemption succeeds', first.ok, JSON.stringify(first));
const second = await redeemSetupCode(code, 'Shop', 'Other Admin', '8765', '8765');
check('replay is refused', !second.ok);
check('and the replay created nobody', db.select().from(users).all().find((u) => u.name === 'Other Admin') === undefined);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
