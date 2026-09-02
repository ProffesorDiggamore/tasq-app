/**
 * Stable error codes, TASQ-Exxxx.
 *
 * Shops see the message; support sees the code. A code is printed verbatim in
 * logs and API responses so "TASQ-E0404" can be looked up in ERROR-CODES.md at
 * the repo root and handed back a plain-English fix — no source diving.
 *
 * Groups: auth 01xx, tasks 02xx, supplies 03xx, push 04xx, setup 05xx,
 * history/other 06xx. Never renumber a code: once shipped it is part of the
 * support contract. Retire by leaving the entry in place.
 *
 * This file must stay dependency-free — proxy.ts and client-visible types
 * transitively reach it, and it must never drag the database in.
 */

export const ERROR_REGISTRY = {
  // --- auth (01xx) ---------------------------------------------------------
  'TASQ-E0101': 'You need to sign in first.',
  'TASQ-E0102': 'Only an admin can do that.',
  'TASQ-E0103': 'That PIN is not right.',
  'TASQ-E0104': 'Too many wrong tries — wait out the lockout, then try again.',
  'TASQ-E0105': 'A PIN is exactly 4 digits.',
  'TASQ-E0106': 'The two PINs did not match.',
  'TASQ-E0107': 'That person already has a PIN.',
  'TASQ-E0108': 'That person has not set up a PIN yet.',
  'TASQ-E0109': 'That person is not on the board.',
  'TASQ-E0110': 'The server is missing its session secret — see .env.example.',
  'TASQ-E0111': 'Too many attempts from this device. Wait a minute and try again.',

  // --- tasks (02xx) --------------------------------------------------------
  'TASQ-E0201': 'That task is gone.',
  'TASQ-E0202': 'That task was cancelled.',
  'TASQ-E0203': 'That task is already done.',
  'TASQ-E0204': 'Someone else already claimed that task.',
  'TASQ-E0205': 'Only admins can add tasks.', // retired — anyone may post since tabs shipped
  'TASQ-E0206': 'Give the task a title.',
  'TASQ-E0207': 'That person is no longer on the board.',
  'TASQ-E0208': "That due time didn't parse — pick it from the picker again.",
  'TASQ-E0209': "Only the task's creator or an admin can edit that.",
  'TASQ-E0210': "Only the task's creator or an admin can cancel that.",
  'TASQ-E0211': 'That task just moved — pull down to refresh and try again.',
  'TASQ-E0212': 'That tab is gone, or you are not on it.',
  'TASQ-E0213': 'Only an admin can put a cash reward on a task.',

  // --- supplies (03xx) -----------------------------------------------------
  'TASQ-E0301': 'Say what you need in the item box.',
  'TASQ-E0302': 'Only an admin can move a supply request along.',
  'TASQ-E0303': 'That supply request is gone.',
  'TASQ-E0304': 'That is not a supply status.',
  'TASQ-E0305': 'Move a supply request one step at a time.',
  'TASQ-E0306': 'Someone else just moved that request.',

  // --- push (04xx) ---------------------------------------------------------
  'TASQ-E0401': 'Sign in to manage notifications.',
  'TASQ-E0402': 'That notification subscription was malformed.',
  'TASQ-E0403': 'Could not read that request.',
  'TASQ-E0404': 'That device is registered to a different person.',
  'TASQ-E0405': 'Too many notification changes — wait a minute.',
  'TASQ-E0406': 'No notification subscription was found for that device.',
  'TASQ-E0407': 'This device has not been approved for this board.',

  // --- setup (05xx) --------------------------------------------------------
  'TASQ-E0501': 'That setup code is not valid or has already been used.',
  'TASQ-E0502': 'This board has already been set up. Sign in instead.',
  'TASQ-E0503': 'Your name needs at least two characters.',
  'TASQ-E0504': 'Someone on the board is already called that. Pick another name.',
  'TASQ-E0505': 'The PIN must be exactly 4 digits.',
  'TASQ-E0506': "Those didn't match. Start again.",
  'TASQ-E0507': 'Too many setup attempts. Wait before trying again.',

  // --- history / other (06xx) ---------------------------------------------
  'TASQ-E0601': 'The database could not be opened for writing.',
  'TASQ-E0602': 'Something went wrong on the server. Try again, or note this code.',

  // --- photo proof (07xx) --------------------------------------------------
  'TASQ-E0701': 'That photo came out too big even after shrinking — try again.',
  'TASQ-E0702': 'That file is not a photo this board can read.',
  'TASQ-E0703': 'That task is gone, so a photo cannot be saved to it.',
  'TASQ-E0704': 'Too many photo changes — wait a minute.',
  'TASQ-E0705': 'There is no photo on that task yet.',
} as const;

export type TasqErrorCode = keyof typeof ERROR_REGISTRY;

export function isTasqErrorCode(code: string): code is TasqErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_REGISTRY, code);
}

/** The one-line plain-English meaning for a code, or a fallback for unknown ones. */
export function errorMessageFor(code: string): string {
  return isTasqErrorCode(code) ? ERROR_REGISTRY[code] : ERROR_REGISTRY['TASQ-E0602'];
}

/**
 * The one error type server code throws on purpose. Anything else that escapes
 * is a bug, and the global handler in instrumentation.ts leaves Next's default
 * noise for it untouched.
 */
export class TasqError extends Error {
  readonly code: TasqErrorCode;
  /** Extra context for logs only — never shown to the shop. */
  readonly detail?: string;

  constructor(code: TasqErrorCode, message?: string, detail?: string) {
    super(message ?? errorMessageFor(code));
    this.name = 'TasqError';
    this.code = code;
    this.detail = detail;
  }
}

export function isTasqError(error: unknown): error is TasqError {
  return error instanceof TasqError;
}

/**
 * The one clean line the global handler prints:
 *   [tasq] TASQ-E0404: That device is registered to a different person.
 */
export function formatTasqLogLine(error: TasqError): string {
  const detail = error.detail ? ` (${error.detail})` : '';
  return `[tasq] ${error.code}: ${error.message}${detail}`;
}
