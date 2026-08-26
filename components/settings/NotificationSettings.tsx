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
  unsupported: "This browser can't do notifications. Chrome or Safari can.",
  insecure:
    "You're on the shop-network address, which can't do notifications — phones only allow them over a secure https connection. Open the board on its https address instead.",
  'needs-install':
    'iPhone only allows notifications once the board is on your home screen. Share → Add to Home Screen, then open it from there.',
  'not-configured':
    "Notifications couldn't start on the server. The keys are generated automatically, so this usually means a database problem — check the server logs.",
  default: 'Get a buzz when a task is assigned to you, or something goes up as ASAP.',
  granted: 'On for this device.',
  denied:
    'Blocked in your browser settings for this site. You can turn it back on there, then come back.',
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
