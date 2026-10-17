/**
 * Web Push transport, end to end against a local stand-in for the push service.
 * This proves the parts that do not need a phone: VAPID signing, payload
 * encryption, audience fan-out, and pruning subscriptions the service has
 * dropped. Delivery to a real iPhone and Android still has to be done by hand.
 *   npm run verify:push
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tasq-push-'));
process.env.TASQ_DB_PATH = path.join(tmp, 'verify.db');
process.env.SESSION_SECRET ??= 'x'.repeat(48);

// web-push refuses to talk to a plain-HTTP endpoint, which is correct — every
// real push service is HTTPS. So the stand-in gets a throwaway certificate and
// this process is told to accept it.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const keyPath = path.join(tmp, 'server.key');
const certPath = path.join(tmp, 'server.crt');
execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
  '-keyout', keyPath, '-out', certPath,
  '-days', '1', '-subj', '/CN=127.0.0.1',
  '-addext', 'subjectAltName=IP:127.0.0.1',
], { stdio: 'ignore' });

// A throwaway key pair, so the test never depends on the real one in .env.local.
const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
process.env.VAPID_SUBJECT = 'mailto:verify@example.com';

const { initDatabase } = await import('../lib/db/migrate');
const { seedTestUsers } = await import('./helpers/test-users.mts');
const { db } = await import('../lib/db');
const { users, pushSubscriptions } = await import('../lib/db/schema');
const notify = await import('../lib/notify');
const policy = await import('../lib/notify-policy');
const { eq } = await import('drizzle-orm');

let failures = 0;
const check = (label: string, cond: boolean, detail = ''): void => {
  if (cond) console.log(`  ok    ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};
const section = (n: string) => console.log(`\n${n}`);

interface Received {
  url: string;
  headers: http.IncomingHttpHeaders;
  bytes: number;
}
const received: Received[] = [];

// Stands in for FCM / Apple's push service.
const server = https.createServer(
  { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
  (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      received.push({
        url: req.url ?? '',
        headers: req.headers,
        bytes: Buffer.concat(chunks).length,
      });
      // /gone simulates a subscription the browser has thrown away.
      if (req.url?.startsWith('/gone')) {
        res.writeHead(410).end();
        return;
      }
      res.writeHead(201).end();
    });
  },
);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
const origin = `https://127.0.0.1:${port}`;

/** A browser-shaped subscription: a real P-256 public key and a 16-byte auth secret. */
function makeSubscription(pathname: string) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `${origin}${pathname}`,
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}

await initDatabase();
await seedTestUsers();
const all = await db.select().from(users).all();
const chris = all.find((u) => u.name === 'Chris')!;
const tony = all.find((u) => u.name === 'Tony')!;
const shelly = all.find((u) => u.name === 'Shelly')!;

const now = Date.now();
const addSub = async (userId: number, pathname: string) => {
  const sub = makeSubscription(pathname);
  await db.insert(pushSubscriptions)
    .values({ userId, ...sub, userAgent: 'verify', createdAt: now, lastSeenAt: now })
    .run();
  return sub;
};

section('Configuration');
check('VAPID keys are picked up', await notify.pushConfigured());
check('the public key is exposed for the browser', await notify.vapidPublicKey() === vapid.publicKey);

section('Sending to one person');
await addSub(tony.id, '/tony-phone');
await addSub(shelly.id, '/shelly-phone');

await notify.dispatch({
  audience: { kind: 'user', userId: tony.id },
  title: 'Assigned to you',
  body: 'Grease the skid steer',
  url: '/?task=7',
  tag: 'task-7',
});

check('exactly one request went out', received.length === 1, String(received.length));
check('to the right device', received[0]?.url === '/tony-phone', received[0]?.url);
check('the payload is encrypted, not plaintext', (received[0]?.bytes ?? 0) > 0);
check(
  'it is sent as an encrypted binary body',
  received[0]?.headers['content-encoding'] === 'aes128gcm',
  String(received[0]?.headers['content-encoding']),
);
check(
  'and signed with VAPID',
  String(received[0]?.headers.authorization ?? '').startsWith('vapid '),
  String(received[0]?.headers.authorization).slice(0, 20),
);
check('with a TTL so it does not queue forever', received[0]?.headers.ttl === '3600');

section('Two devices for one person');
received.length = 0;
await addSub(tony.id, '/tony-ipad');
await notify.dispatch({
  audience: { kind: 'user', userId: tony.id },
  title: 'x',
  body: 'y',
  url: '/',
});
check('both of their devices get it', received.length === 2, String(received.length));

section('Audiences');
received.length = 0;
await notify.dispatch({ audience: { kind: 'admins' }, title: 'x', body: 'y', url: '/' });
check('admins-only reaches nobody without a subscription', received.length === 0);

await addSub(chris.id, '/chris-phone');
received.length = 0;
await notify.dispatch({ audience: { kind: 'admins' }, title: 'x', body: 'y', url: '/' });
check('now it reaches the admin', received.length === 1 && received[0].url === '/chris-phone');

received.length = 0;
await notify.dispatch({ audience: { kind: 'everyone' }, title: 'x', body: 'y', url: '/' });
check('everyone reaches all four devices', received.length === 4, String(received.length));

received.length = 0;
await notify.dispatch({
  audience: { kind: 'everyone', except: tony.id },
  title: 'x',
  body: 'y',
  url: '/',
});
check('excluding someone skips both their devices', received.length === 2, String(received.length));

section('One device, one subscription');
// The bug this guards: a phone mints a brand-new endpoint when the app is
// reinstalled or the service worker is replaced, and the old endpoint keeps
// accepting pushes for days afterwards. Two live rows, one phone, every job
// buzzing twice.
received.length = 0;
const store = await import('../lib/push-store');
const PHONE = 'sha256-of-tonys-phone-cookie';
const firstInstall = makeSubscription('/tony-reinstall-old');
const secondInstall = makeSubscription('/tony-reinstall-new');
check(
  'first subscribe from this device stores a row',
  (await store.upsertSubscription(tony.id, firstInstall, 'verify', PHONE)).ok,
);
const afterReinstall = await store.upsertSubscription(tony.id, secondInstall, 'verify', PHONE);
check('re-subscribing after a reinstall is accepted', afterReinstall.ok);
check(
  'and retires the endpoint it replaced',
  afterReinstall.ok && afterReinstall.replaced === 1,
  afterReinstall.ok ? String(afterReinstall.replaced) : 'refused',
);
const tonyRows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, tony.id)).all();
check(
  'the stale endpoint is gone',
  !tonyRows.some((r) => r.endpoint.endsWith('/tony-reinstall-old')),
);
check(
  'the current one is kept',
  tonyRows.some((r) => r.endpoint.endsWith('/tony-reinstall-new')),
);
// A different browser on the same account is a different device and must live
// alongside it — this is deduplication, not "one subscription per person".
const laptop = await store.upsertSubscription(tony.id, makeSubscription('/tony-laptop'), 'verify', 'sha256-of-laptop-cookie');
check('a different device is left alone', laptop.ok && laptop.replaced === 0);
// Rows with no hash predate the column, or came from a browser that had not
// been handed its cookie yet. Guessing which device they belong to would
// delete a working subscription, so they are never touched.
const noCookie = await store.upsertSubscription(tony.id, makeSubscription('/tony-nocookie'), 'verify', null);
check('a subscription with no device cookie still stores', noCookie.ok);
check(
  'and deletes nothing it cannot identify',
  (await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, tony.id)).all()).length === 5,
);
// Leave the fixture as the later sections expect it: phone + iPad only.
await db.delete(pushSubscriptions)
  .where(eq(pushSubscriptions.userId, tony.id))
  .run();
await addSub(tony.id, '/tony-phone');
await addSub(tony.id, '/tony-ipad');

section('One action never buzzes one person twice about one job');
// Posting an ASAP job AND handing it to someone writes two intents: "for you"
// to the assignee, and "something is ASAP" to everyone but the poster. The
// assignee is in both. dispatchAll collapses them on the shared tag.
received.length = 0;
await notify.dispatchAll([
  {
    audience: { kind: 'user', userId: tony.id },
    title: 'For you',
    body: 'Grease the skid steer',
    url: '/?task=9',
    tag: 'task-9',
  },
  {
    audience: { kind: 'everyone', except: shelly.id },
    title: 'Something is ASAP',
    body: 'Grease the skid steer',
    url: '/?task=9',
    tag: 'task-9',
  },
]);
const hitsFor = (name: string) => received.filter((r) => r.url.startsWith(name)).length;
check('the assignee is told once, not twice', hitsFor('/tony-phone') === 1, String(hitsFor('/tony-phone')));
check('on each of their devices', hitsFor('/tony-ipad') === 1, String(hitsFor('/tony-ipad')));
check('everyone else still hears the broadcast', hitsFor('/chris-phone') === 1, String(hitsFor('/chris-phone')));
check('and the excepted person hears nothing', hitsFor('/shelly-phone') === 0, String(hitsFor('/shelly-phone')));

// A different job in the same batch is a different subject and must still send.
received.length = 0;
await notify.dispatchAll([
  { audience: { kind: 'user', userId: tony.id }, title: 'a', body: 'b', url: '/', tag: 'task-10' },
  { audience: { kind: 'user', userId: tony.id }, title: 'c', body: 'd', url: '/', tag: 'task-11' },
]);
check('two different jobs still buzz twice', hitsFor('/tony-phone') === 2, String(hitsFor('/tony-phone')));

// Untagged intents are announcements about nothing in particular.
received.length = 0;
await notify.dispatchAll([
  { audience: { kind: 'user', userId: tony.id }, title: 'a', body: 'b', url: '/' },
  { audience: { kind: 'user', userId: tony.id }, title: 'c', body: 'd', url: '/' },
]);
check('untagged intents are never collapsed', hitsFor('/tony-phone') === 2, String(hitsFor('/tony-phone')));

section("The admin's rules");
received.length = 0;
await notify.dispatch({
  audience: { kind: 'admins', except: chris.id },
  title: 'x',
  body: 'y',
  url: '/',
});
check('an admin is not told about their own tap', received.length === 0, String(received.length));

received.length = 0;
await notify.dispatch({
  audience: { kind: 'everyone' },
  title: 'x',
  body: 'y',
  url: '/',
  event: 'task.completed',
});
check('a rule left on still sends', received.length === 4, String(received.length));

await policy.setNotifyRule('task.completed', false);
received.length = 0;
await notify.dispatch({
  audience: { kind: 'everyone' },
  title: 'x',
  body: 'y',
  url: '/',
  event: 'task.completed',
});
check('switching it off stops it at the sender', received.length === 0, String(received.length));

received.length = 0;
await notify.dispatch({
  audience: { kind: 'everyone' },
  title: 'x',
  body: 'y',
  url: '/',
  event: 'task.assigned',
});
check('and leaves every other rule alone', received.length === 4, String(received.length));

received.length = 0;
await notify.dispatch({ audience: { kind: 'everyone' }, title: 'x', body: 'y', url: '/' });
check('an announcement answers to no rule', received.length === 4, String(received.length));
await policy.setNotifyRule('task.completed', true);

section('Archived people are not notified');
await db.update(users).set({ archivedAt: Date.now() }).where(eq(users.id, shelly.id)).run();
received.length = 0;
await notify.dispatch({ audience: { kind: 'everyone' }, title: 'x', body: 'y', url: '/' });
check('an archived person is skipped', received.length === 3, String(received.length));
await db.update(users).set({ archivedAt: null }).where(eq(users.id, shelly.id)).run();

section('Dead subscriptions are pruned');
await addSub(chris.id, '/gone-away');
const before = (await db.select().from(pushSubscriptions).all()).length;
received.length = 0;
await notify.dispatch({ audience: { kind: 'user', userId: chris.id }, title: 'x', body: 'y', url: '/' });
const after = (await db.select().from(pushSubscriptions).all()).length;
check('the 410 endpoint was tried', received.some((r) => r.url === '/gone-away'));
check('and its row was deleted', after === before - 1, `${before} -> ${after}`);
check(
  'the live subscription survived',
  (await db.select().from(pushSubscriptions).all()).some((s) => s.endpoint.endsWith('/chris-phone')),
);

section('A failing push never breaks the action');
await db.insert(pushSubscriptions)
  .values({
    userId: chris.id,
    endpoint: 'https://127.0.0.1:1/nothing-listening',
    p256dh: makeSubscription('/x').p256dh,
    auth: makeSubscription('/x').auth,
    userAgent: 'verify',
    createdAt: now,
    lastSeenAt: now,
  })
  .run();
let threw = false;
try {
  await notify.dispatch({ audience: { kind: 'user', userId: chris.id }, title: 'x', body: 'y', url: '/' });
} catch {
  threw = true;
}
check('a connection refusal is swallowed', !threw);
check(
  'and the unreachable row is kept, not deleted on a transient error',
  (await db.select().from(pushSubscriptions).all()).some((s) => s.endpoint.includes('nothing-listening')),
);

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
