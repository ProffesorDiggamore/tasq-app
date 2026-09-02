'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { detectPlatform } from '@/lib/pwa';
import {
  currentPushState,
  disablePush,
  enablePush,
  hasSubscription,
  type PushState,
} from '@/lib/push-client';
import { haptic } from '@/lib/haptics';

const EXPLANATION: Record<PushState, string> = {
  unsupported: "This browser can't do notifications. Use Chrome or Safari.",
  insecure:
    "You're on a local network address — notifications need HTTPS. Open the board on its secure address, or use localhost on the shop Mac.",
  'needs-install':
    'iPhone requires the board on your home screen for notifications. Share → Add to Home Screen, then open from there.',
  'not-configured':
    "Notifications aren't set up on the server. Check server logs.",
  default: 'Get a buzz when a task is assigned to you or goes ASAP.',
  granted: 'On for this device.',
  denied:
    'Blocked in browser settings. Turn it back on there, then return.',
};

export function NotificationSettings() {
  const [state, setState] = useState<PushState | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const platform = detectPlatform();
    const next = await currentPushState(platform.isIOS, platform.isStandalone);
    setState(next);
    setSubscribed(next === 'granted' ? await hasSubscription() : false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state === null) return null;

  return (
    <section>
      <h2 className="type-label px-1 text-[var(--text-tertiary)]">Notifications</h2>
      <div className="material-card mt-2.5 rounded-[var(--radius-card)] p-4">
        <p className="type-callout text-[var(--text-secondary)]">{EXPLANATION[state]}</p>

        {state === 'default' || (state === 'granted' && !subscribed) ? (
          <Button
            tone="primary"
            size="md"
            fullWidth
            disabled={busy}
            className="mt-3"
            onPress={() => {
              setBusy(true);
              void enablePush().then(async (next) => {
                haptic(next === 'granted' ? 'commit' : 'error');
                await refresh();
                setBusy(false);
              });
            }}
          >
            {busy ? 'Asking…' : 'Turn on notifications'}
          </Button>
        ) : null}

        {state === 'granted' && subscribed ? (
          <Button
            tone="quiet"
            size="md"
            fullWidth
            disabled={busy}
            className="mt-3"
            onPress={() => {
              setBusy(true);
              void disablePush().then(async () => {
                await refresh();
                setBusy(false);
              });
            }}
          >
            {busy ? 'Turning off…' : 'Stop notifications on this device'}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
