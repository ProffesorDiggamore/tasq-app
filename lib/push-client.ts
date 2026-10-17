'use client';

/** Browser side of Web Push: permission, subscription, and tearing it down. */
export type PushState =
  | 'unsupported'
  /** Reached over plain HTTP, where the push APIs do not exist at all. */
  | 'insecure'
  | 'needs-install'
  | 'not-configured'
  /**
   * This browser's push endpoint already belongs to someone else on the board —
   * the person who first turned notifications on here. The server refuses to
   * re-point it, because doing so would silently steal their notifications.
   */
  | 'claimed-by-someone-else'
  | 'default'
  | 'granted'
  | 'denied';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function serverKey(): Promise<string | null> {
  const response = await fetch('/api/push', { cache: 'no-store' });
  if (!response.ok) return null;
  const data = (await response.json()) as { key: string | null };
  return data.key;
}

export async function currentPushState(isIOS: boolean, isStandalone: boolean): Promise<PushState> {
  if (typeof window === 'undefined') return 'unsupported';

  // Checked before anything else. Service workers and PushManager only exist in
  // a secure context, so on the plain-HTTP shop-network address they are simply
  // absent — which is indistinguishable from an ancient browser unless we ask.
  // Without this the board tells people their phone is at fault when the real
  // answer is that they are on the wrong address.
  if (!window.isSecureContext) return 'insecure';

  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    // iOS Safari in a tab reports exactly this until the app is installed.
    return isIOS && !isStandalone ? 'needs-install' : 'unsupported';
  }
  if (isIOS && !isStandalone) return 'needs-install';
  if ((await serverKey()) === null) return 'not-configured';
  return Notification.permission as PushState;
}

/**
 * Whether a subscription the browser is already holding was minted against the
 * key this server now signs with.
 *
 * A subscription outlives the keys: regenerate the pair (a wiped database, a
 * deployment that later sets VAPID_PUBLIC_KEY) and the browser happily hands
 * back the old one, which every push service then refuses with a 403 forever.
 * Reused blindly, that looks exactly like "notifications silently stopped".
 *
 * A browser that will not tell us which key it used is treated as a match: an
 * unknown key is not a wrong one, and churning a working subscription on every
 * visit costs more than the rare stale one, which the server now names in its
 * 403 log.
 */
function mintedWithCurrentKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const applied = subscription.options?.applicationServerKey;
  if (!applied) return true;
  const bytes = new Uint8Array(applied);
  return bytes.length === key.length && bytes.every((b, i) => b === key[i]);
}

/** Ask, subscribe, and hand the subscription to the server. */
export async function enablePush(): Promise<PushState> {
  const key = await serverKey();
  if (key === null) return 'not-configured';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission as PushState;

  const registration = await navigator.serviceWorker.ready;
  const keyBytes = urlBase64ToUint8Array(key);
  let existing = await registration.pushManager.getSubscription();
  if (existing && !mintedWithCurrentKey(existing, keyBytes)) {
    // Drop the server's row too: nothing will ever be delivered through it, and
    // waiting for a 404/410 to clean it up means every send carries a dead push.
    await fetch('/api/push', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: existing.endpoint }),
    });
    await existing.unsubscribe();
    existing = null;
  }
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      // Chrome refuses a subscription that is not user-visible.
      userVisibleOnly: true,
      applicationServerKey: keyBytes as BufferSource,
    }));

  const stored = await fetch('/api/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  });

  // The answer used to be thrown away, so a refusal looked exactly like success:
  // the screen said "On for this device" and nothing ever arrived. The browser
  // subscription is deliberately left alone — it belongs to whoever registered
  // it first, and unsubscribing here would take their notifications with it.
  if (!stored.ok) {
    return stored.status === 403 ? 'claimed-by-someone-else' : 'not-configured';
  }

  return 'granted';
}

/**
 * Drops this device's subscription. The browser permission itself can only be
 * revoked by the person in their own settings, so this stops the sending rather
 * than pretending to un-ask.
 */
export async function disablePush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const removed = await fetch('/api/push', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  // A refusal means the row is someone else's on a shared device. Unsubscribing
  // the browser anyway would silently switch off THEIR notifications.
  if (removed.ok) await subscription.unsubscribe();
}

/**
 * Whether this browser's subscription delivers to the person signed in now —
 * not merely whether the browser holds one, which on a shared tablet is usually
 * somebody else's.
 */
export async function hasSubscription(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;
  const response = await fetch(`/api/push?endpoint=${encodeURIComponent(subscription.endpoint)}`, {
    cache: 'no-store',
  });
  if (!response.ok) return false;
  return ((await response.json()) as { mine?: boolean }).mine === true;
}
