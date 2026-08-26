import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { setupCodes, users } from '@/lib/db/schema';
import { hashPin, isValidPinFormat } from '@/lib/auth/pin';
import { setSetting, DEFAULT_ORG_NAME } from '@/lib/settings';
import { logActivity } from '@/lib/activity';
import { DB_PATH } from '@/lib/paths';

/**
 * One-time codes.
 *
 * A fresh install ships with zero people on it. The first boot mints an
 * `initial` code, prints it and files it next to the database; whoever owns
 * the deployment hands it to the business, who redeems it at /setup to create
 * the first admin account. From then on initial codes stop working — setup is
 * a door that closes behind you.
 *
 * The `recovery` kind is the deliberate way to reopen that door: someone with
 * access to the machine runs `npm run recover`, and the printed code adds a
 * new admin at /setup even though people already exist. Physical access to
 * the Mac is what authorizes it — nothing web-reachable can mint one.
 */

/** Unambiguous alphabet — no 0/O/1/I/L, so a code read over the phone survives. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;
const CODE_FILE_NAME = 'setup-code.txt';

export type SetupCodeKind = 'initial' | 'recovery';

export type RedeemResult =
  | { ok: true; adminId: number }
  | {
      ok: false;
      reason:
        | 'bad-code'
        | 'already-set-up'
        | 'bad-name'
        | 'name-taken'
        | 'bad-pin'
        | 'pin-mismatch';
    };

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Accepts "ABCD-2345" or "abcd2345" and returns the canonical dashed uppercase
 * form — or null when the input cannot be a code. Every comparison downstream
 * hashes this exact string.
 */
function normalizeCode(raw: string): string | null {
  // Strips everything outside the unambiguous alphabet: digits 2-9, letters
  // minus I, L and O.
  const clean = raw.trim().toUpperCase().replace(/[^2-9ABCDEFGHJKMNPQRSTUVWXYZ]/g, '');
  if (clean.length !== CODE_LENGTH) return null;
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (i === 3) out += '-';
  }
  return out;
}

export function hasActiveUsers(): boolean {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .where(isNull(users.archivedAt))
    .get();
  return (row?.n ?? 0) > 0;
}

function hasUnusedCode(kind?: SetupCodeKind): boolean {
  const where = isNull(setupCodes.usedAt);
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(setupCodes)
    .where(kind ? and(where, eq(setupCodes.kind, kind)) : where)
    .get();
  return (row?.n ?? 0) > 0;
}

/** True when a live board has an unused recovery code waiting at /setup. */
export function canRecover(): boolean {
  return hasActiveUsers() && hasUnusedCode('recovery');
}

/** The file an initial code was filed under. Deleted the moment it is used. */
function codeFilePath(): string {
  return path.join(path.dirname(DB_PATH), CODE_FILE_NAME);
}

/**
 * Called once per server start from migrate.ts. Mints the activation code for
 * a board that has nobody on it yet — never for one that does, and never a
 * second while an unclaimed one exists.
 */
export function ensureSetupCode(): void {
  if (hasActiveUsers() || hasUnusedCode('initial')) return;

  const code = generateCode();
  db.insert(setupCodes)
    .values({ codeHash: hashCode(code), kind: 'initial', createdAt: Date.now() })
    .run();

  // Filed next to the database so a test run against a throwaway DB never
  // touches the live file, and a backup of data/ carries the code with it.
  const file = codeFilePath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        'One-time setup code for this board.',
        'Redeem it at /setup to create the first admin account.',
        `Code: ${code}`,
        '',
        'This file deletes itself once the board is set up.',
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
  } catch {
    // A read-only data directory must not stop the server from booting; the
    // code is still in the database and was printed below.
  }

  console.log('');
  console.log('┌──────────────────────────────────────────────────────┐');
  console.log('│  First-time setup                                    │');
  console.log(`│                                                      │`);
  console.log(`│  Setup code:  ${code}                              │`);
  console.log('│                                                      │');
  console.log('│  Open /setup, enter this code, and create your       │');
  console.log('│  admin account. Also saved to setup-code.txt         │');
  console.log('│  next to the database.                               │');
  console.log('└──────────────────────────────────────────────────────┘');
  console.log('');
}

/**
 * Mints an admin-recovery code for a live board — the escape hatch for "our
 * only admin left and nobody knows the PIN". Run from the machine itself:
 *   npm run recover
 */
export function mintRecoveryCode(): string | null {
  if (!hasActiveUsers()) return null;
  if (hasUnusedCode('recovery')) return null;

  const code = generateCode();
  db.insert(setupCodes)
    .values({ codeHash: hashCode(code), kind: 'recovery', createdAt: Date.now() })
    .run();

  console.log('');
  console.log('┌──────────────────────────────────────────────────────┐');
  console.log('│  Admin recovery                                      │');
  console.log(`│                                                      │`);
  console.log(`│  Recovery code:  ${code}                          │`);
  console.log('│                                                      │');
  console.log('│  Open /setup on the board, enter this code, and      │');
  console.log('│  create a new admin account. It works once.          │');
  console.log('└──────────────────────────────────────────────────────┘');
  console.log('');
  return code;
}

export function verifySetupCode(raw: string): boolean {
  const code = normalizeCode(raw);
  if (code === null) return false;
  const row = db
    .select({ id: setupCodes.id })
    .from(setupCodes)
    .where(and(eq(setupCodes.codeHash, hashCode(code)), isNull(setupCodes.usedAt)))
    .get();
  return row !== undefined;
}

/**
 * Redeems a code into an admin account and consumes it.
 *
 * - `initial` — fresh installs only. Creates the first admin, names the board,
 *   deletes the code file. Once anyone exists these codes are dead.
 * - `recovery` — live boards only. Adds another admin; the board's name and
 *   people are untouched.
 *
 * The claim is a conditional UPDATE that only matches an unused row — SQLite
 * serialises writes, so of two submissions racing each other exactly one wins,
 * and the loser deletes the account it had started.
 */
export async function redeemSetupCode(
  rawCode: string,
  orgName: string,
  adminName: string,
  pin: string,
  confirm: string,
): Promise<RedeemResult> {
  const code = normalizeCode(rawCode);
  if (code === null) return { ok: false, reason: 'bad-code' };

  const pending = db
    .select({ kind: setupCodes.kind })
    .from(setupCodes)
    .where(and(eq(setupCodes.codeHash, hashCode(code)), isNull(setupCodes.usedAt)))
    .get();
  if (!pending) {
    // Set-up-ness is answered before "invalid" so a stale initial code on a
    // live board gets the truthful rejection.
    if (hasActiveUsers()) return { ok: false, reason: 'already-set-up' };
    return { ok: false, reason: 'bad-code' };
  }
  const recovery = pending.kind === 'recovery';
  if (!recovery && hasActiveUsers()) return { ok: false, reason: 'already-set-up' };
  if (recovery && !hasActiveUsers()) return { ok: false, reason: 'bad-code' };

  const name = adminName.trim().replace(/\s+/g, ' ');
  const org = orgName.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (name.length < 2) return { ok: false, reason: 'bad-name' };
  const clash = db.select({ id: users.id }).from(users).where(eq(users.name, name)).get();
  if (clash) return { ok: false, reason: 'name-taken' };
  if (!isValidPinFormat(pin)) return { ok: false, reason: 'bad-pin' };
  if (pin !== confirm) return { ok: false, reason: 'pin-mismatch' };

  const pinHash = await hashPin(pin);
  const now = Date.now();
  const inserted = db
    .insert(users)
    .values({ name, isAdmin: true, isFounder: !recovery, pinHash, createdAt: now })
    .returning({ id: users.id })
    .get();

  const matched = db
    .update(setupCodes)
    .set({ usedAt: now })
    .where(and(eq(setupCodes.codeHash, hashCode(code)), isNull(setupCodes.usedAt)))
    .run();

  if (matched.changes === 0) {
    // Another submission claimed the code first. Undo this account so exactly
    // one winner's choices stand.
    db.delete(users).where(eq(users.id, inserted.id)).run();
    return { ok: false, reason: recovery ? 'bad-code' : 'already-set-up' };
  }

  if (recovery) {
    logActivity({
      actorId: inserted.id,
      verb: 'user.recovered',
      subjectType: 'user',
      subjectId: inserted.id,
      summary: `${name} used a recovery code to become an admin`,
    });
  } else {
    setSetting('org.name', org.length > 0 ? org : DEFAULT_ORG_NAME);
    try {
      fs.rmSync(codeFilePath(), { force: true });
    } catch {
      // The database is the source of truth; the file is a courtesy copy.
    }
    logActivity({
      actorId: inserted.id,
      verb: 'board.setup',
      subjectType: 'user',
      subjectId: inserted.id,
      summary: `${name} set up the board as its first admin`,
    });
  }

  return { ok: true, adminId: inserted.id };
}
