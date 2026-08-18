'use client';

/** Browser-side facts about how the board is being viewed. */
export interface Platform {
  isIOS: boolean;
  isAndroid: boolean;
  /** Running from the home screen rather than in a browser tab. */
  isStandalone: boolean;
  /** iOS only allows Web Push for home-screen apps on 16.4+. */
  supportsPush: boolean;
}

export function detectPlatform(): Platform {
  if (typeof window === 'undefined') {
    return { isIOS: false, isAndroid: false, isStandalone: false, supportsPush: false };
  }
  const ua = navigator.userAgent;
  const isAndroid = /Android/.test(ua);
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS reports itself as a Mac; touch points give it away. The Android
    // exclusion matters because a device-emulating browser can spoof the user
    // agent while still reporting the host's platform, and mistaking Android
    // for an iPad would hide the install prompt that Android can actually use.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 && !isAndroid);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

  return {
    isIOS,
    isAndroid,
    isStandalone,
    supportsPush: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
  };
}

/**
 * Counters kept in localStorage so a hint that has been ignored twice stops
 * appearing. Nagging is how people learn to dismiss everything on sight.
 */
export function timesSeen(key: string): number {
  if (typeof localStorage === 'undefined') return 0;
  return Number(localStorage.getItem(key) ?? '0');
}

export function markSeen(key: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, String(timesSeen(key) + 1));
}

export function markDone(key: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, '99');
}

export const INSTALL_HINT_KEY = 'apex.installHint';
export const PUSH_HINT_KEY = 'apex.pushHint';
export const MAX_HINTS = 2;
