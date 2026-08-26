'use client';

import { useEffect } from 'react';

/**
 * Registers the worker after the page has settled, so it never competes with
 * first paint. Failures are logged and otherwise ignored — the board works
 * without it; only offline fallback and push depend on it.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Never in development. The worker caches /_next/static/ cache-first, which
    // is right for hashed production assets and wrong for dev chunks — it pins
    // old code and edits stop appearing. This also tears down a worker left
    // behind by a previous production build on the same origin.
    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) void registration.unregister();
      });
      if ('caches' in window) {
        void caches.keys().then((keys) => {
          for (const key of keys) if (key.startsWith('tasq')) void caches.delete(key);
        });
      }
      return;
    }

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
        console.warn('[tasq] service worker registration failed', error);
      });
    };
    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
