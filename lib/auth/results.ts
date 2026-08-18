/**
 * Server-action results are discriminated unions rather than thrown errors, so
 * the UI can say something specific ("3 tries left") instead of "something went
 * wrong". Lives outside the 'use server' file, which may only export functions.
 */
export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'wrong-pin'; attemptsRemaining: number }
  | { ok: false; reason: 'locked'; retryAfterMs: number; message: string }
  | { ok: false; reason: 'bad-format' }
  | { ok: false; reason: 'mismatch' }
  | { ok: false; reason: 'already-enrolled' }
  | { ok: false; reason: 'not-enrolled' }
  | { ok: false; reason: 'unknown-user' };

export interface PersonSummary {
  id: number;
  name: string;
  isAdmin: boolean;
  /** False the first time someone taps their name — they set a PIN instead of entering one. */
  enrolled: boolean;
}
