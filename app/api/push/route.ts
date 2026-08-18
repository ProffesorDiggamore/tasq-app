import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { pushSubscriptions } from '@/lib/db/schema';
import { currentUser } from '@/lib/auth/session';
import { vapidPublicKey } from '@/lib/notify';

export const dynamic = 'force-dynamic';

/** The browser needs the public key to build a subscription. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'not-authenticated' }, { status: 401 });
  const key = vapidPublicKey();
  return NextResponse.json({ key, configured: key !== null });
}

/** Store (or refresh) this device's subscription for the signed-in person. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'not-authenticated' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad-json' }, { status: 400 });
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
    return NextResponse.json({ error: 'bad-subscription' }, { status: 400 });
  }

  const now = Date.now();
  const values = {
    userId: user.id,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    userAgent: request.headers.get('user-agent'),
    createdAt: now,
    lastSeenAt: now,
  };

  // The endpoint is unique. A shared iPad that switches people must move the
  // subscription to whoever is signed in now, not fan out to both.
  db.insert(pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: user.id, p256dh: values.p256dh, auth: values.auth, lastSeenAt: now },
    })
    .run();

  return NextResponse.json({ ok: true });
}

/** Called when someone turns notifications off on this device. */
export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'not-authenticated' }, { status: 401 });

  let endpoint: string | null = null;
  try {
    const body = (await request.json()) as { endpoint?: unknown };
    if (typeof body.endpoint === 'string') endpoint = body.endpoint;
  } catch {
    /* fall through */
  }
  if (endpoint === null) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).run();
  return NextResponse.json({ ok: true });
}
