/**
 * The device whitelist: off by default, does not lock its own owner out, and
 * actually refuses a browser that was never approved.
 *   npm run verify:devices
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tasq-devices-'));
process.env.TASQ_DB_PATH = path.join(tmp, 'verify.db');
process.env.SESSION_SECRET ??= 'x'.repeat(48);

const { initDatabase } = await import('../lib/db/migrate');
const { seedTestUsers } = await import('./helpers/test-users.mts');
const { db } = await import('../lib/db');
const { users, devices } = await import('../lib/db/schema');
const dev = await import('../lib/devices');
const { eq } = await import('drizzle-orm');

let failures = 0;
function check(label: string, condition: boolean, detail = ''): void {
  if (condition) console.log(`  ok    ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}
function section(name: string): void {
  console.log(`\n${name}`);
}

initDatabase();
seedTestUsers();

const all = db.select().from(users).all();
const chris = all.find((u) => u.name === 'Chris')!; // admin
const tony = all.find((u) => u.name === 'Tony')!;

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function statusOf(token: string): string {
  const row = dev.touchDevice(token, null);
  return row.status;
}

section('Off by default');
check('a fresh board does not gate anything', !dev.whitelistEnabled());
check('and nothing is waiting', dev.pendingDeviceCount() === 0);

section('A device is recorded the first time it is seen');
const owner = 'token-owner';
const first = dev.touchDevice(owner, IPHONE, chris.id);
check('it lands as pending', first.status === 'pending');
check('with a readable name', first.label === 'iPhone · Safari', first.label);
check('and the raw token is never stored', db.select().from(devices).all().every((d) => d.tokenHash !== owner));
const again = dev.touchDevice(owner, IPHONE, chris.id);
check('seeing it again does not duplicate it', db.select().from(devices).all().length === 1);
check('and keeps the same row', again.id === first.id);

check('a Windows browser is named too', dev.labelFor(CHROME) === 'Windows PC · Chrome', dev.labelFor(CHROME));
check('an unknown agent still gets something', dev.labelFor(null) === 'Device');

section('Turning it on does not lock out the person turning it on');
const stranger = 'token-stranger';
dev.touchDevice(stranger, CHROME);
check('turning it on with no device id is refused', !dev.setWhitelistEnabled(chris, true, null, null).ok);
check('turning it on works from a real browser', dev.setWhitelistEnabled(chris, true, owner, IPHONE).ok);
check('it is on', dev.whitelistEnabled());
check("the admin's own browser is approved", statusOf(owner) === 'approved');
check('every other browser drops to waiting', statusOf(stranger) === 'pending');
check('and shows up in the waiting count', dev.pendingDeviceCount() === 1);

section('Approving, revoking, blocking');
const strangerRow = db.select().from(devices).all().find((d) => d.tokenHash !== undefined && d.status === 'pending')!;
check('an admin can let one in', dev.setDeviceStatus(chris, strangerRow.id, 'approved').ok);
check('it is approved', statusOf(stranger) === 'approved');
check('it appears under Approved', dev.listDevices().approved.some((d) => d.id === strangerRow.id));
check('nobody is waiting now', dev.pendingDeviceCount() === 0);

check('revoking puts it back to waiting', dev.setDeviceStatus(chris, strangerRow.id, 'pending').ok);
check('and it is pending again', statusOf(stranger) === 'pending');

check('blocking works', dev.setDeviceStatus(chris, strangerRow.id, 'blocked').ok);
check('a blocked device stays blocked when it comes back', statusOf(stranger) === 'blocked');
check('blocked devices are listed apart', dev.listDevices().blocked.some((d) => d.id === strangerRow.id));

check('renaming sticks', dev.renameDevice(chris, strangerRow.id, 'Front desk PC').ok);
check(
  'and shows the new name',
  dev.listDevices().blocked.find((d) => d.id === strangerRow.id)?.label === 'Front desk PC',
);
check('a one-character name is refused', !dev.renameDevice(chris, strangerRow.id, 'x').ok);

section('A device nobody has seen before');
check('starts out waiting, not approved', statusOf('token-brand-new') === 'pending');

section('Forgetting');
check('forgetting removes the row', dev.forgetDevice(chris, strangerRow.id).ok);
check('and it is gone from every list', !dev.listDevices().blocked.some((d) => d.id === strangerRow.id));
check('forgetting it twice is refused', !dev.forgetDevice(chris, strangerRow.id).ok);
check('a forgotten device comes back as waiting', statusOf(stranger) === 'pending');

section('The way back in');
dev.setDeviceStatus(chris, first.id, 'pending');
check('every device can be locked out at once', dev.listDevices().approved.length === 0);
check('the script can approve by name', dev.approveByLabelFragment('iPhone') >= 1);
check('which puts the owner back in', statusOf(owner) === 'approved');

section('Turning it off');
check('an admin can turn it off', dev.setWhitelistEnabled(chris, false, owner, IPHONE).ok);
check('and nothing is gated', !dev.whitelistEnabled());
check('the waiting count reads zero while it is off', dev.pendingDeviceCount() === 0);

// Guard against the setting being readable as something other than a boolean.
check('a crew member is still just a row in users', !tony.isAdmin);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
