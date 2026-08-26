'use server';

import { signIn } from '@/lib/auth/session';
import { redeemSetupCode, verifySetupCode, hasActiveUsers } from '@/lib/setup';

export type SetupResult = { ok: true } | { ok: false; message: string };

/** Step-one feedback only. The redemption re-checks everything for real. */
export async function checkSetupCodeAction(code: string): Promise<boolean> {
  if (hasActiveUsers()) return false;
  return verifySetupCode(code);
}

/**
 * The one-time activation. Creates the first admin account and signs it in;
 * every later person is added from Settings by an admin.
 */
export async function completeSetupAction(
  code: string,
  orgName: string,
  adminName: string,
  pin: string,
  confirm: string,
): Promise<SetupResult> {
  if (hasActiveUsers()) {
    return { ok: false, message: 'This board has already been set up. Sign in instead.' };
  }

  const result = await redeemSetupCode(code, orgName, adminName, pin, confirm);
  if (!result.ok) {
    switch (result.reason) {
      case 'bad-code':
        return { ok: false, message: 'That code is not valid or has already been used.' };
      case 'already-set-up':
        return { ok: false, message: 'This board has already been set up. Sign in instead.' };
      case 'bad-name':
        return { ok: false, message: 'Your name needs at least two characters.' };
      case 'name-taken':
        return { ok: false, message: 'Someone on the board is already called that. Pick another name.' };
      case 'bad-pin':
        return { ok: false, message: 'The PIN must be exactly 4 digits.' };
      case 'pin-mismatch':
        return { ok: false, message: "Those didn't match. Start again." };
    }
  }

  await signIn(result.adminId);
  return { ok: true };
}
