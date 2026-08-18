/**
 * Generates the VAPID key pair the board signs push messages with.
 *   node scripts/generate-vapid.mjs
 *
 * Run this ONCE and keep the result. Regenerating invalidates every phone's
 * existing subscription, and everyone has to turn notifications on again.
 */
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com');
console.log('\nPaste these into .env.local, then restart the server.');
