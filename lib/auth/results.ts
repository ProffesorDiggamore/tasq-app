/**
 * Server-action results are discriminated unions rather than thrown errors, so
 * the UI can say something specific ("3 tries left") instead of "something went
 * wrong". Lives outside the 'use server' file, which may only export functions.
 *
 * Every failure also carries its stable TASQ-E code (see lib/errors.ts and
 * ERROR-CODES.md) — the UI keeps speaking human, support gets the code.
 */
import type { TasqErrorCode } from '@/lib/errors';

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'wrong-pin'; attemptsRemaining: number; code: Extract<TasqErrorCode, 'TASQ-E0103'> }
  | { ok: false; reason: 'locked'; retryAfterMs: number; message: string; code: Extract<TasqErrorCode, 'TASQ-E0104' | 'TASQ-E0111'> }
  | { ok: false; reason: 'bad-format'; code: Extract<TasqErrorCode, 'TASQ-E0105'> }
  | { ok: false; reason: 'mismatch'; code: Extract<TasqErrorCode, 'TASQ-E0106'> }
  | { ok: false; reason: 'already-enrolled'; code: Extract<TasqErrorCode, 'TASQ-E0107'> }
  | { ok: false; reason: 'not-enrolled'; code: Extract<TasqErrorCode, 'TASQ-E0108'> }
  | { ok: false; reason: 'unknown-user'; code: Extract<TasqErrorCode, 'TASQ-E0109'> };

export interface PersonSummary {
  id: number;
  name: string;
  isAdmin: boolean;
  /** False the first time someone taps their name — they set a PIN instead of entering one. */
  enrolled: boolean;
}
