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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-push-'));
process.env.APEX_DB_PATH = path.join(tmp, 'verify.db');
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

const { migrateAndSeed } = await import('../lib/db/migrate');
const { db } = await import('../lib/db');
const { users, pushSubscriptions } = await import('../lib/db/schema');
const notify = await import('../lib/notify');
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

migrateAndSeed();
const all = db.select().from(users).all();
const chris = all.find((u) => u.name === 'Chris')!;
const tony = all.find((u) => u.name === 'Tony')!;
const shelly = all.find((u) => u.name === 'Shelly')!;

const now = Date.now();
const addSub = (userId: number, pathname: string) => {
  const sub = makeSubscription(pathname);
  db.insert(pushSubscriptions)
    .values({ userId, ...sub, userAgent: 'verify', createdAt: now, lastSeenAt: now })
    .run();
  return sub;
};

section('Configuration');
check('VAPID keys are picked up', notify.pushConfigured());
check('the public key is exposed for the browser', notify.vapidPublicKey() === vapid.publicKey);

section('Sending to one person');
addSub(tony.id, '/tony-phone');
addSub(shelly.id, '/shelly-phone');

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
addSub(tony.id, '/tony-ipad');
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

addSub(chris.id, '/chris-phone');
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

section('Archived people are not notified');
db.update(users).set({ archivedAt: Date.now() }).where(eq(users.id, shelly.id)).run();
received.length = 0;
await notify.dispatch({ audience: { kind: 'everyone' }, title: 'x', body: 'y', url: '/' });
check('an archived person is skipped', received.length === 3, String(received.length));
db.update(users).set({ archivedAt: null }).where(eq(users.id, shelly.id)).run();

section('Dead subscriptions are pruned');
addSub(chris.id, '/gone-away');
const before = db.select().from(pushSubscriptions).all().length;
received.length = 0;
await notify.dispatch({ audience: { kind: 'user', userId: chris.id }, title: 'x', body: 'y', url: '/' });
const after = db.select().from(pushSubscriptions).all().length;
check('the 410 endpoint was tried', received.some((r) => r.url === '/gone-away'));
check('and its row was deleted', after === before - 1, `${before} -> ${after}`);
check(
  'the live subscription survived',
  db.select().from(pushSubscriptions).all().some((s) => s.endpoint.endsWith('/chris-phone')),
);

section('A failing push never breaks the action');
db.insert(pushSubscriptions)
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
  db.select().from(pushSubscriptions).all().some((s) => s.endpoint.includes('nothing-listening')),
);

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
