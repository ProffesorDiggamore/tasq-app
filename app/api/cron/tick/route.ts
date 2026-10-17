import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runTick } from '@/lib/scheduler';

export const dynamic = 'force-dynamic';

/**
 * The scheduler's door when the board is hosted (Netlify): the scheduled
 * function in netlify/functions/tick.mts posts here every few minutes, because
 * there is no long-lived server to keep an interval running.
 *
 * The caller proves itself with a token derived from SESSION_SECRET, which both
 * sides already hold — no extra secret for the shop owner to set. Anyone else
 * gets a 404, so the route does not even confirm it exists.
 */
function expectedToken(): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  return createHash('sha256').update(`${secret}:cron`).digest('hex');
}

function authorized(request: Request): boolean {
  const expected = expectedToken();
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!expected || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export async function POST(request: Request) {
  if (!authorized(request)) return new NextResponse(null, { status: 404 });
  const report = await runTick();
  return NextResponse.json({ ok: true, ...report });
}
