'use client';

/** Browser side of Web Push: permission, subscription, and tearing it down. */
export type PushState =
  | 'unsupported'
  | 'needs-install'
  | 'not-configured'
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
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    // iOS Safari in a tab reports exactly this until the app is installed.
    return isIOS && !isStandalone ? 'needs-install' : 'unsupported';
  }
  if (isIOS && !isStandalone) return 'needs-install';
  if ((await serverKey()) === null) return 'not-configured';
  return Notification.permission as PushState;
}

/** Ask, subscribe, and hand the subscription to the server. */
export async function enablePush(): Promise<PushState> {
  const key = await serverKey();
  if (key === null) return 'not-configured';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission as PushState;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      // Chrome refuses a subscription that is not user-visible.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    }));

  await fetch('/api/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  });

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
  await fetch('/api/push', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
}

export async function hasSubscription(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  const registration = await navigator.serviceWorker.ready;
  return (await registration.pushManager.getSubscription()) !== null;
}
