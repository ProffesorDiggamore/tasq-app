/**
 * Exercises first-run activation against a throwaway database: the setup code
 * lifecycle, redemption into a first admin account, and VAPID key provisioning.
 *   npm run verify:onboarding
 * Nothing here touches data/tasq.db — TASQ_DB_PATH points somewhere temporary.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tasq-onboard-'));
process.env.TASQ_DB_PATH = path.join(tmp, 'verify.db');
process.env.SESSION_SECRET ??= 'x'.repeat(48);
// Start from the auto-provision path; the env-override test sets these itself.
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

const { initDatabase } = await import('../lib/db/migrate');
const { db } = await import('../lib/db');
const { appSettings, setupCodes, users } = await import('../lib/db/schema');
const setup = await import('../lib/setup');
const notify = await import('../lib/notify');
const { verifyPin } = await import('../lib/auth/pin');
const { eq } = await import('drizzle-orm');

let failures = 0;
function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(name: string): void {
  console.log(`\n${name}`);
}

function codeFromFile(): string {
  return fs
    .readFileSync(path.join(tmp, 'setup-code.txt'), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('Code:'))!
    .slice(5)
    .trim();
}

section('First boot');
initDatabase();
check('no people on a fresh board', db.select({ id: users.id }).from(users).all().length === 0);
check('recovering a board with nobody on it is refused', setup.mintRecoveryCode() === null);
check('one unused code minted', db.select().from(setupCodes).all().length === 1);
check('code file written next to the database', fs.existsSync(path.join(tmp, 'setup-code.txt')));
check('file is readable text holding the code', /^[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(codeFromFile()));
check('stored hash is not the code', !db.select().from(setupCodes).get()!.codeHash.includes(codeFromFile()));

const code = codeFromFile();

section('Code verification');
check('right code accepted', setup.verifySetupCode(code));
check('lowercase without dash accepted', setup.verifySetupCode((code).toLowerCase().replace('-', '')));
check('garbage refused', !setup.verifySetupCode('hello world'));
check('short input refused', !setup.verifySetupCode('AB2'));
check('wrong but well-formed code refused', !setup.verifySetupCode('ZZZZ-ZZZZ'));
check('ambiguous letters are never minted', !/[0O1IL]/.test(code));

section('Redemption');
const wrong = await setup.redeemSetupCode('AAAA-BBBB', 'Shop', 'Pat', '1234', '1234');
check('unknown code refused', !wrong.ok && wrong.reason === 'bad-code');
const mismatch = await setup.redeemSetupCode((code), 'Shop', 'Pat', '1234', '9999');
check('PIN confirmation mismatch refused', !mismatch.ok && mismatch.reason === 'pin-mismatch');
const badPin = await setup.redeemSetupCode((code), 'Shop', 'Pat', '12ab', '12ab');
check('non-digit PIN refused', !badPin.ok && badPin.reason === 'bad-pin');
const shortName = await setup.redeemSetupCode((code), 'Shop', 'P', '1234', '1234');
check('single-character name refused', !shortName.ok && shortName.reason === 'bad-name');

const good = await setup.redeemSetupCode((code), '   Cedar   Supply ', ' Pat Doe ', '2481', '2481');
check('valid redemption succeeds', good.ok);
const pat = db.select().from(users).where(eq(users.name, 'Pat Doe')).get()!;
check('first admin created', pat.isAdmin);
check('they are the founder', pat.isFounder);
check('PIN verifies against the stored hash', await verifyPin('2481', pat.pinHash!));
check(
  'business name trimmed and stored',
  db.select().from(appSettings).where(eq(appSettings.key, 'org.name')).get()?.value === 'Cedar Supply',
);
check('code consumed by redemption', !setup.verifySetupCode(code));

const again = await setup.redeemSetupCode((code), 'Other', 'Nina', '1111', '1111');
check('reused code refused', !again.ok && again.reason === 'already-set-up');
check('refused redemption created nobody', db.select({ id: users.id }).from(users).all().length === 1);
check(
  'the code file deleted itself',
  !fs.existsSync(path.join(tmp, 'setup-code.txt')),
);

section('The door closes behind you');
initDatabase();
const codeRows = db.select().from(setupCodes).all();
check('a set-up board mints no new codes on reboot', codeRows.length === 1);
check('that code is the initial kind', codeRows[0].kind === 'initial');

section('Admin recovery');
const staleInitial = await setup.redeemSetupCode(code, '', 'Zoe', '5555', '5555');
check(
  'a used initial code cannot touch the live board',
  !staleInitial.ok && staleInitial.reason === 'already-set-up',
);
const recoveryCode = setup.mintRecoveryCode();
check('recovery code minted for a live board', typeof recoveryCode === 'string');
check('second mint refused while one waits', setup.mintRecoveryCode() === null);
check('recovery door is open at /setup', setup.canRecover());
check('no second file appeared', !fs.existsSync(path.join(tmp, 'setup-code.txt')));

const taken = await setup.redeemSetupCode(recoveryCode!, '', 'Pat Doe', '9876', '9876');
check('redeeming under an existing name refused', !taken.ok && taken.reason === 'name-taken');

// The org name is deliberately not part of a recovery redemption.
const recovered = await setup.redeemSetupCode(recoveryCode!, 'Should Be Ignored', 'Nina', '9876', '9876');
check('recovery code adds a new admin to the live board', recovered.ok);
const nina = db.select().from(users).where(eq(users.name, 'Nina')).get()!;
check('the new account is an admin with a hashed PIN', nina.isAdmin && nina.pinHash!.startsWith('scrypt$'));
check('recovery admins are not founders', !nina.isFounder);
check(
  'business name untouched by recovery',
  db.select().from(appSettings).where(eq(appSettings.key, 'org.name')).get()?.value === 'Cedar Supply',
);
check('recovery code consumed', !setup.verifySetupCode(recoveryCode!));
check('recovery door closed again', !setup.canRecover());
check('board now holds two people', db.select({ id: users.id }).from(users).all().length === 2);

section('Push keys provision themselves');
const keyOnce = notify.vapidPublicKey();
check('a public key exists without any .env editing', typeof keyOnce === 'string' && keyOnce.length > 40);
const stored = db.select().from(appSettings).where(eq(appSettings.key, 'vapid.keys')).get();
check('the pair was saved to the database', stored !== undefined);
const pair = JSON.parse(stored!.value) as { publicKey: string; privateKey: string };
check('saved public half matches what the browser gets', pair.publicKey === keyOnce);
check('push reports configured', notify.pushConfigured());
const keyTwice = notify.vapidPublicKey();
check('second read returns the same key — no regeneration', keyTwice === keyOnce);

process.env.VAPID_PUBLIC_KEY = 'env-public-key-for-override-test';
process.env.VAPID_PRIVATE_KEY = 'env-private-key-for-override-test';
check(
  'environment variables take priority when set',
  notify.vapidPublicKey() === 'env-public-key-for-override-test',
);
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
check('and the database pair is untouched afterwards', notify.vapidPublicKey() === keyOnce);

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
