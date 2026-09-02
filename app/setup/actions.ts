'use server';

import { headers } from 'next/headers';
import { signIn } from '@/lib/auth/session';
import { redeemSetupCode, verifySetupCode, hasActiveUsers } from '@/lib/setup';
import { rateLimit, penaltyState, recordPenalty } from '@/lib/rate-limit';

export type SetupResult = { ok: true } | { ok: false; message: string; code: string };

/** The caller's address, as far as a single-server deployment can know it. */
async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return h.get('x-real-ip') ?? 'local';
}

/** Step-one feedback only. The redemption re-checks everything for real. */
export async function checkSetupCodeAction(code: string): Promise<boolean> {
  if (hasActiveUsers()) return false;
  // This endpoint answers "is that the code?", so it is exactly what a
  // guesser would drive — cap it like the redemption itself.
  const limit = rateLimit(`setup:check:${await clientIp()}`, 10, 60_000);
  if (!limit.allowed) return false;
  return verifySetupCode(code);
}

/**
 * The one-time activation. Creates the first admin account and signs it in;
 * every later person is added from Settings by an admin.
 *
 * The setup code is an 8-character secret, so wrong guesses buy a doubling
 * backoff per address — 5s, 10s, 20s … capped at 15 minutes — on top of the
 * 10-per-minute ceiling on the check endpoint.
 */
export async function completeSetupAction(
  code: string,
  orgName: string,
  adminName: string,
  pin: string,
  confirm: string,
): Promise<SetupResult> {
  const ip = await clientIp();

  if (hasActiveUsers()) {
    return { ok: false, code: 'TASQ-E0502', message: 'This board has already been set up. Sign in instead.' };
  }

  const penalty = penaltyState(`setup:fail:${ip}`);
  if (penalty.blocked) {
    const wait = Math.ceil(penalty.retryAfterMs / 1000);
    return {
      ok: false,
      code: 'TASQ-E0507',
      message: `Too many attempts. Wait ${wait} second${wait === 1 ? '' : 's'} and try again.`,
    };
  }

  const limit = rateLimit(`setup:redeem:${ip}`, 10, 60_000);
  if (!limit.allowed) {
    return { ok: false, code: 'TASQ-E0507', message: 'Too many attempts. Wait a minute and try again.' };
  }

  const result = await redeemSetupCode(code, orgName, adminName, pin, confirm);
  if (!result.ok) {
    // Every refusal — including field-validation misses — feeds the ladder,
    // so a guesser cannot separate the code check from the noise.
    recordPenalty(`setup:fail:${ip}`, 5_000, 15 * 60_000);
    switch (result.reason) {
      case 'bad-code':
        return { ok: false, code: 'TASQ-E0501', message: 'That code is not valid or has already been used.' };
      case 'already-set-up':
        return { ok: false, code: 'TASQ-E0502', message: 'This board has already been set up. Sign in instead.' };
      case 'bad-name':
        return { ok: false, code: 'TASQ-E0503', message: 'Your name needs at least two characters.' };
      case 'name-taken':
        return { ok: false, code: 'TASQ-E0504', message: 'Someone on the board is already called that. Pick another name.' };
      case 'bad-pin':
        return { ok: false, code: 'TASQ-E0505', message: 'The PIN must be exactly 4 digits.' };
      case 'pin-mismatch':
        return { ok: false, code: 'TASQ-E0506', message: "Those didn't match. Start again." };
    }
  }

  await signIn(result.adminId);
  return { ok: true };
}
