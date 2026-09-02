import 'server-only';
import { createHash } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { asc, desc, eq, isNull, ne } from 'drizzle-orm';
import { db } from '@/lib/db';
import { devices, users, type Device, type User } from '@/lib/db/schema';
import { logActivity } from '@/lib/activity';
import { getSetting, setSetting } from '@/lib/settings';
import { fail, ok, type ActionResult } from '@/lib/action-result';
import type { DeviceRow } from '@/lib/board-types';

/**
 * Device whitelisting: the board is only reachable from browsers the owner has
 * let in.
 *
 * Off by default. It exists for the deployment where the board is published to
 * the open internet through a tunnel — at that point knowing the address is no
 * longer a meaningful gate, and a stolen or forwarded link would otherwise be
 * enough. With it on, a new browser lands on a "waiting to be let in" screen
 * and shows up in Settings → Devices for the owner to approve or ignore.
 *
 * This sits *in front of* the PIN login, not instead of it. A device being
 * approved says "this browser may talk to the board"; the PIN still says who
 * is talking.
 */

export const DEVICE_COOKIE = 'tasq_device';
/** Ten years: a shop iPad should be let in once and never asked again. */
export const DEVICE_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

const WHITELIST_KEY = 'whitelist.enabled';

export function whitelistEnabled(): boolean {
  return getSetting(WHITELIST_KEY) === 'true';
}

/** The token never leaves the browser; only this does. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * A readable name from the user agent — not fingerprinting, just enough for
 * the owner to tell "the shop iPad" from "someone's Android" in a list they
 * are about to approve. Renameable afterwards, which is the real answer.
 */
export function labelFor(userAgent: string | null): string {
  const ua = userAgent ?? '';
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Macintosh|Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows PC'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Device';
  const browser = /EdgA?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  return browser ? `${device} · ${browser}` : device;
}

export type GateStatus = 'off' | 'approved' | 'pending' | 'blocked';

export interface GateResult {
  status: GateStatus;
  label: string | null;
}

/**
 * Runs on every page render. Records the browser, then says whether it may see
 * the board. Never throws and never writes a cookie — proxy.ts mints the token
 * before the request reaches here, because a Server Component may not set one.
 */
export async function deviceGate(viewerId: number | null = null): Promise<GateResult> {
  if (!whitelistEnabled()) return { status: 'off', label: null };

  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  // No token yet means the very first request of a browsing session, before
  // proxy.ts's Set-Cookie has come back around. Treat it as pending rather
  // than approving something unidentified.
  if (!token) return { status: 'pending', label: null };

  const userAgent = (await headers()).get('user-agent');
  const row = touchDevice(token, userAgent, viewerId);
  return { status: row.status, label: row.label };
}

/**
 * The same gate for API routes, which never render a layout and so never pass
 * through the one in app/layout.tsx. True means "let this request through".
 * A session obtained before the whitelist was switched on would otherwise keep
 * working against the API long after its browser lost the right to the board.
 */
export async function deviceAllowed(): Promise<boolean> {
  const gate = await deviceGate();
  return gate.status === 'off' || gate.status === 'approved';
}

/** Upsert-and-stamp. Separate from the gate so a script can call it too. */
export function touchDevice(
  token: string,
  userAgent: string | null,
  viewerId: number | null = null,
  now: number = Date.now(),
): Device {
  const tokenHash = hashToken(token);
  const existing = db.select().from(devices).where(eq(devices.tokenHash, tokenHash)).get();

  if (existing) {
    db.update(devices)
      .set({ lastSeenAt: now, lastUserId: viewerId ?? existing.lastUserId })
      .where(eq(devices.id, existing.id))
      .run();
    return { ...existing, lastSeenAt: now, lastUserId: viewerId ?? existing.lastUserId };
  }

  return db
    .insert(devices)
    .values({
      tokenHash,
      label: labelFor(userAgent),
      userAgent,
      status: 'pending',
      firstSeenAt: now,
      lastSeenAt: now,
      lastUserId: viewerId,
    })
    .returning()
    .get();
}

/** Waiting first, then approved, each newest-seen first. */
export function listDevices(): { waiting: DeviceRow[]; approved: DeviceRow[]; blocked: DeviceRow[] } {
  const rows = db
    .select({
      id: devices.id,
      label: devices.label,
      status: devices.status,
      firstSeenAt: devices.firstSeenAt,
      lastSeenAt: devices.lastSeenAt,
      lastUserName: users.name,
    })
    .from(devices)
    .leftJoin(users, eq(users.id, devices.lastUserId))
    .orderBy(desc(devices.lastSeenAt), asc(devices.id))
    .all();

  const shape = (r: (typeof rows)[number]): DeviceRow => ({
    id: r.id,
    label: r.label,
    status: r.status,
    firstSeenAt: r.firstSeenAt,
    lastSeenAt: r.lastSeenAt,
    lastUserName: r.lastUserName,
  });

  return {
    waiting: rows.filter((r) => r.status === 'pending').map(shape),
    approved: rows.filter((r) => r.status === 'approved').map(shape),
    blocked: rows.filter((r) => r.status === 'blocked').map(shape),
  };
}

export function pendingDeviceCount(): number {
  if (!whitelistEnabled()) return 0;
  return db.select({ id: devices.id }).from(devices).where(eq(devices.status, 'pending')).all()
    .length;
}

export function setDeviceStatus(
  admin: User,
  deviceId: number,
  status: 'approved' | 'pending' | 'blocked',
  now: number = Date.now(),
): ActionResult {
  const device = db.select().from(devices).where(eq(devices.id, deviceId)).get();
  if (!device) return fail('That device is gone.');
  if (device.status === status) return ok;

  db.update(devices)
    .set({
      status,
      approvedBy: status === 'approved' ? admin.id : null,
      approvedAt: status === 'approved' ? now : null,
    })
    .where(eq(devices.id, deviceId))
    .run();

  logActivity(
    {
      actorId: admin.id,
      verb: status === 'approved' ? 'device.approved' : 'device.revoked',
      subjectType: 'device',
      subjectId: deviceId,
      summary:
        status === 'approved'
          ? `${admin.name} let ${device.label} onto the board`
          : `${admin.name} ${status === 'blocked' ? 'blocked' : 'revoked'} ${device.label}`,
    },
    now,
  );
  return ok;
}

export function renameDevice(
  admin: User,
  deviceId: number,
  rawLabel: string,
  now: number = Date.now(),
): ActionResult {
  const label = rawLabel.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (label.length < 2) return fail('Give it a name of at least two characters.');

  const device = db.select().from(devices).where(eq(devices.id, deviceId)).get();
  if (!device) return fail('That device is gone.');

  db.update(devices).set({ label }).where(eq(devices.id, deviceId)).run();
  logActivity(
    {
      actorId: admin.id,
      verb: 'device.renamed',
      subjectType: 'device',
      subjectId: deviceId,
      summary: `${admin.name} renamed ${device.label} to ${label}`,
    },
    now,
  );
  return ok;
}

export function forgetDevice(admin: User, deviceId: number, now: number = Date.now()): ActionResult {
  const device = db.select().from(devices).where(eq(devices.id, deviceId)).get();
  if (!device) return fail('That device is gone.');

  db.delete(devices).where(eq(devices.id, deviceId)).run();
  logActivity(
    {
      actorId: admin.id,
      verb: 'device.revoked',
      subjectType: 'device',
      subjectId: deviceId,
      summary: `${admin.name} removed ${device.label} from the device list`,
    },
    now,
  );
  return ok;
}

/**
 * Turning the gate on must not lock the person turning it on out of their own
 * board, so their current browser is approved in the same breath. Every other
 * device already seen drops to pending — the point of switching this on is to
 * decide about them one at a time.
 */
export function setWhitelistEnabled(
  admin: User,
  enabled: boolean,
  currentToken: string | null,
  userAgent: string | null,
  now: number = Date.now(),
): ActionResult {
  if (enabled && !currentToken) {
    return fail('Reload the page once, then turn it on — this browser has no device ID yet.');
  }

  setSetting(WHITELIST_KEY, enabled ? 'true' : 'false');

  if (enabled && currentToken) {
    const mine = touchDevice(currentToken, userAgent, admin.id, now);
    db.update(devices)
      .set({ status: 'approved', approvedBy: admin.id, approvedAt: now })
      .where(eq(devices.id, mine.id))
      .run();
    // Anything else that has ever hit this board is a decision, not a default.
    db.update(devices)
      .set({ status: 'pending', approvedBy: null, approvedAt: null })
      .where(ne(devices.id, mine.id))
      .run();
  }

  logActivity(
    {
      actorId: admin.id,
      verb: 'device.whitelist',
      subjectType: 'setting',
      subjectId: null,
      summary: `${admin.name} turned the device whitelist ${enabled ? 'on' : 'off'}`,
    },
    now,
  );
  return ok;
}

/** Used by scripts/devices.mts, which is the way back in if every device is out. */
export function approveByLabelFragment(fragment: string, now: number = Date.now()): number {
  const rows = db.select().from(devices).where(isNull(devices.approvedAt)).all();
  const matches = rows.filter((d) => d.label.toLowerCase().includes(fragment.toLowerCase()));
  for (const d of matches) {
    db.update(devices).set({ status: 'approved', approvedAt: now }).where(eq(devices.id, d.id)).run();
  }
  return matches.length;
}
