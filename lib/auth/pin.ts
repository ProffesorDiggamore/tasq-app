import 'server-only';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * A 4-digit PIN is 10,000 combinations, so the hash has to be genuinely slow —
 * fast hashes (SHA/MD5/bcrypt-at-low-cost) would fall to a laptop in seconds if
 * the database file ever walked out of the shop. N=2^16 costs ~64MB and a few
 * hundred ms per attempt, which is invisible to a person and ruinous to a
 * brute-forcer. The throttle in throttle.ts is the other half of the defence.
 */
const SCRYPT_N = 1 << 16;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MAX_MEM = 256 * 1024 * 1024;

export const PIN_LENGTH = 4;

export function isValidPinFormat(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

/** Stored as `scrypt$N$r$p$saltB64$hashB64` so old hashes survive a parameter change. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(pin, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEM,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const expected = Buffer.from(hashB64, 'base64');
  const derived = await scryptAsync(pin, Buffer.from(saltB64, 'base64'), expected.length, {
    N,
    r,
    p,
    maxmem: MAX_MEM,
  });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
