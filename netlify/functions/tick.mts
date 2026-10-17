import { createHash } from 'node:crypto';

/**
 * The board's clock when hosted on Netlify. On the shop Mac an in-process
 * interval spawns repeating tasqs and sends overdue nudges every minute; a
 * serverless deploy has no process that stays up, so Netlify runs this on a
 * schedule instead and it asks the app to do one tick (app/api/cron/tick).
 *
 * Every five minutes, not every one: the free plan has a monthly allowance and
 * this runs around the clock. A repeating tasq set for 7:00 shows up by 7:05.
 * Scheduled functions only run on the published production deploy.
 */
export default async (_req: Request, context: { site?: { url?: string } }) => {
  const site = context.site?.url ?? process.env.URL;
  const secret = process.env.SESSION_SECRET;
  if (!site || !secret) {
    console.error('[tasq] tick skipped: site URL or SESSION_SECRET is missing');
    return;
  }

  const token = createHash('sha256').update(`${secret}:cron`).digest('hex');
  const response = await fetch(new URL('/api/cron/tick', site), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) console.error(`[tasq] tick failed: HTTP ${response.status}`);
  else console.log('[tasq] tick', await response.text());
};

// Times are UTC, but "every five minutes" does not care.
export const config = { schedule: '*/5 * * * *' };
