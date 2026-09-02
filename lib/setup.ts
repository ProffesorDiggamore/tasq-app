import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { setupCodes, users, type SetupCode } from '@/lib/db/schema';
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
 * Constant-time comparison of the candidate code's hash against a stored hash.
 * timingSafeEqual throws on length mismatch — hashes here are always 64 hex
 * chars, so a length check first only guards against a corrupt row.
 */
function hashesMatch(computedHex: string, storedHex: string): boolean {
  const computed = Buffer.from(computedHex, 'hex');
  const stored = Buffer.from(storedHex, 'hex');
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}

/**
 * Finds the unused code row matching `raw`, comparing hashes in constant time.
 * The candidate never rides into SQL as a comparison operand: the (very short)
 * list of unused codes is read and each stored hash is checked with
 * timingSafeEqual, so a probe of guess timing learns nothing about a code.
 */
function findUnusedCode(raw: string): SetupCode | undefined {
  const code = normalizeCode(raw);
  if (code === null) return undefined;
  const computed = hashCode(code);
  const rows = db.select().from(setupCodes).where(isNull(setupCodes.usedAt)).all();
  for (const row of rows) {
    if (hashesMatch(computed, row.codeHash)) return row;
  }
  return undefined;
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

/** The single line the setup code is filed under, so it round-trips. */
function codeFileBody(code: string): string {
  return [
    'One-time setup code for this board.',
    'Redeem it at /setup to create the first admin account.',
    `Code: ${code}`,
    '',
    'This file deletes itself once the board is set up.',
    '',
  ].join('\n');
}

/** Reads the plaintext code back out of setup-code.txt, or null if it is gone. */
function readCodeFile(): string | null {
  try {
    const line = fs
      .readFileSync(codeFilePath(), 'utf8')
      .split('\n')
      .find((l) => l.startsWith('Code:'));
    return line ? normalizeCode(line.slice('Code:'.length)) : null;
  } catch {
    return null;
  }
}

function printSetupCode(code: string): void {
  const line = `  Setup code:  ${code}`;
  const width = Math.max(line.length, 52) + 2;
  const rule = '─'.repeat(width);
  const pad = (s: string) => `│${s}${' '.repeat(width - s.length)}│`;
  console.log('');
  console.log(`┌${rule}┐`);
  console.log(pad('  First-time setup'));
  console.log(pad(''));
  console.log(pad(line));
  console.log(pad(''));
  console.log(pad('  Open /setup in a browser, enter this code, and'));
  console.log(pad('  create your admin account. Also saved to'));
  console.log(pad('  data/setup-code.txt next to the database.'));
  console.log(`└${rule}┘`);
  console.log('');
}

/**
 * Called once per server start from migrate.ts. A board with nobody on it yet
 * needs its activation code in front of whoever is watching the server window —
 * so this prints on *every* boot until the board is claimed, not just the boot
 * that mints the code. Minting still happens exactly once: an unused code is
 * re-surfaced from setup-code.txt rather than replaced.
 */
export function ensureSetupCode(): void {
  if (hasActiveUsers()) return;

  const file = codeFilePath();

  if (hasUnusedCode('initial')) {
    // A code was already minted on an earlier boot. Its plaintext only exists
    // in the file — the database keeps a hash — so re-print from there.
    const existing = readCodeFile();
    if (existing) {
      printSetupCode(existing);
      return;
    }
    // The file was removed but the board was never set up, so the code is
    // unrecoverable. Drop the dead row and mint a fresh one below.
    db.delete(setupCodes)
      .where(and(eq(setupCodes.kind, 'initial'), isNull(setupCodes.usedAt)))
      .run();
  }

  const code = generateCode();
  db.insert(setupCodes)
    .values({ codeHash: hashCode(code), kind: 'initial', createdAt: Date.now() })
    .run();

  // Filed next to the database so a test run against a throwaway DB never
  // touches the live file, and a backup of data/ carries the code with it.
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, codeFileBody(code), { mode: 0o600 });
  } catch {
    // A read-only data directory must not stop the server from booting; the
    // code is still in the database and was printed below.
  }

  printSetupCode(code);
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
  return findUnusedCode(raw) !== undefined;
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

  // Single constant-time lookup; `code` is only hashed, never compared in SQL.
  const claimed = findUnusedCode(code);
  if (!claimed) {
    // Set-up-ness is answered before "invalid" so a stale initial code on a
    // live board gets the truthful rejection.
    if (hasActiveUsers()) return { ok: false, reason: 'already-set-up' };
    return { ok: false, reason: 'bad-code' };
  }
  const recovery = claimed.kind === 'recovery';
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

  // The claim is a conditional UPDATE that only matches this exact, still-
  // unused row — SQLite serialises writes, so of two submissions racing each
  // other exactly one wins, and a replayed code (recovery or initial) can never
  // be consumed twice.
  const matched = db
    .update(setupCodes)
    .set({ usedAt: now })
    .where(and(eq(setupCodes.id, claimed.id), isNull(setupCodes.usedAt)))
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
