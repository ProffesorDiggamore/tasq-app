import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth/session';
import { DEVICE_COOKIE, deviceAllowed, hashToken } from '@/lib/devices';
import { vapidPublicKey } from '@/lib/notify';
import { upsertSubscription, removeSubscription, ownsSubscription } from '@/lib/push-store';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** The client IP, as far as a single-server deployment can know it. */
function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'local';
}

function tooMany(retryAfterMs: number) {
  return NextResponse.json(
    { error: 'rate-limited', code: 'TASQ-E0405' },
    { status: 429, headers: { 'retry-after': String(Math.ceil(retryAfterMs / 1000)) } },
  );
}

/**
 * The browser needs the public key to build a subscription. With `?endpoint=`,
 * also answers whether that subscription is the signed-in person's — only ever
 * "yours" or "not yours", never whose.
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!(await deviceAllowed())) {
    return NextResponse.json({ error: 'device-not-approved', code: 'TASQ-E0407' }, { status: 403 });
  }
  if (!user) {
    return NextResponse.json({ error: 'not-authenticated', code: 'TASQ-E0401' }, { status: 401 });
  }
  const key = await vapidPublicKey();
  const endpoint = new URL(request.url).searchParams.get('endpoint');
  const mine = endpoint ? await ownsSubscription(user.id, endpoint) : false;
  return NextResponse.json({ key, configured: key !== null, mine });
}

/** Store (or refresh) this device's subscription for the signed-in person. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!(await deviceAllowed())) {
    return NextResponse.json({ error: 'device-not-approved', code: 'TASQ-E0407' }, { status: 403 });
  }
  if (!user) {
    return NextResponse.json({ error: 'not-authenticated', code: 'TASQ-E0401' }, { status: 401 });
  }

  // Ten subscription changes a minute per person-and-address is far more than
  // any real device needs and starves a script flipping subscriptions.
  const limit = rateLimit(`push:post:${user.id}:${clientIp(request)}`, 10, 60_000);
  if (!limit.allowed) return tooMany(limit.retryAfterMs);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad-json', code: 'TASQ-E0403' }, { status: 400 });
  }

  const sub = body as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  if (
    typeof sub.endpoint !== 'string' ||
    typeof sub.keys?.p256dh !== 'string' ||
    typeof sub.keys?.auth !== 'string'
  ) {
    return NextResponse.json({ error: 'bad-subscription', code: 'TASQ-E0402' }, { status: 400 });
  }

  // Which browser this is, so a phone that re-subscribed after a reinstall
  // replaces its own stale endpoint instead of buzzing alongside it. Absent on
  // the very first request, before proxy.ts's Set-Cookie comes back around —
  // that is a missed deduplication, not a reason to refuse the subscription.
  const deviceToken = (await cookies()).get(DEVICE_COOKIE)?.value;

  const result = await upsertSubscription(
    user.id,
    { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    request.headers.get('user-agent'),
    deviceToken ? hashToken(deviceToken) : null,
  );
  if (!result.ok) {
    // 403: the endpoint is real but owned by someone else. Never re-point or
    // delete another person's device.
    return NextResponse.json({ error: 'subscription-owned', code: result.code }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}

/** Called when someone turns notifications off on this device. */
export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!(await deviceAllowed())) {
    return NextResponse.json({ error: 'device-not-approved', code: 'TASQ-E0407' }, { status: 403 });
  }
  if (!user) {
    return NextResponse.json({ error: 'not-authenticated', code: 'TASQ-E0401' }, { status: 401 });
  }

  const limit = rateLimit(`push:delete:${user.id}:${clientIp(request)}`, 10, 60_000);
  if (!limit.allowed) return tooMany(limit.retryAfterMs);

  let endpoint: string | null = null;
  try {
    const body = (await request.json()) as { endpoint?: unknown };
    if (typeof body.endpoint === 'string') endpoint = body.endpoint;
  } catch {
    /* fall through */
  }
  if (endpoint === null) {
    return NextResponse.json({ error: 'bad-request', code: 'TASQ-E0403' }, { status: 400 });
  }

  // Scoped to the session user: another person's subscription is untouchable,
  // and a miss answers 404 without confirming the endpoint exists at all.
  const result = await removeSubscription(user.id, endpoint);
  if (!result.ok) {
    return NextResponse.json({ error: 'not-found', code: result.code }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
