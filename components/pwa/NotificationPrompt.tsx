'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/Button';
import { MAX_HINTS, PUSH_HINT_KEY, detectPlatform, markDone, markSeen, timesSeen } from '@/lib/pwa';
import { currentPushState, enablePush } from '@/lib/push-client';
import { haptic } from '@/lib/haptics';
import { SPRING_SHEET } from '@/lib/motion';

/**
 * Asked in context, after someone is already signed in and looking at the
 * board — never on first paint, where a permission dialog has no story
 * attached and gets denied out of reflex.
 */
export function NotificationPrompt() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Kept out here so unmount can cancel it even if the promise settles first.
    let showTimer = 0;
    const platform = detectPlatform();
    if (timesSeen(PUSH_HINT_KEY) >= MAX_HINTS) return;

    void currentPushState(platform.isIOS, platform.isStandalone).then((state) => {
      if (cancelled) return;
      // Only worth asking when asking can actually succeed.
      if (state !== 'default') return;
      showTimer = window.setTimeout(() => {
        markSeen(PUSH_HINT_KEY);
        setShow(true);
      }, 2400);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(showTimer);
    };
  }, []);

  return (
    <AnimatePresence>
      {show ? (
        <motion.aside
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={SPRING_SHEET}
          className="material-sheet fixed inset-x-3 z-40 rounded-[var(--radius-sheet)] p-4"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5.75rem)' }}
          role="dialog"
          aria-label="Turn on notifications"
        >
          <h2 className="type-headline">Get told when something&apos;s yours</h2>
          <p className="type-callout mt-1.5 text-[var(--text-secondary)]">
            A buzz when a task is assigned to you or something goes up as ASAP — instead of finding
            out at the end of the day.
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              tone="quiet"
              grow
              disabled={busy}
              onPress={() => {
                markDone(PUSH_HINT_KEY);
                setShow(false);
              }}
            >
              Not now
            </Button>
            <Button
              tone="primary"
              grow
              disabled={busy}
              onPress={() => {
                setBusy(true);
                void enablePush().then((state) => {
                  setBusy(false);
                  haptic(state === 'granted' ? 'commit' : 'error');
                  markDone(PUSH_HINT_KEY);
                  setShow(false);
                });
              }}
            >
              {busy ? 'Asking…' : 'Turn them on'}
            </Button>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
