/**
 * Mints a one-time admin-recovery code for a live board.
 *   npm run recover
 *
 * The escape hatch for "our only admin left and nobody knows the PIN". Run it
 * on the Mac that holds the database — physical access is the authorization —
 * then enter the printed code at /setup to create a new admin account.
 */
import { initDatabase } from '../lib/db/migrate';
import { hasActiveUsers, mintRecoveryCode } from '../lib/setup';

initDatabase();

if (!hasActiveUsers()) {
  console.log('This board has nobody on it yet — nothing to recover.');
  console.log('Use the first-time setup code instead: open /setup in a browser.');
  process.exit(1);
}

const code = mintRecoveryCode();
if (code === null) {
  console.log('A recovery code has already been minted and not used yet.');
  console.log('Redeem that one first — it works once, at /setup.');
  process.exit(1);
}
