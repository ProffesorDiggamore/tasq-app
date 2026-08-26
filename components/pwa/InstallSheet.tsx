'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/Button';
import {
  INSTALL_HINT_KEY,
  MAX_HINTS,
  detectPlatform,
  markDone,
  markSeen,
  timesSeen,
} from '@/lib/pwa';
import { SPRING_SHEET } from '@/lib/motion';

/**
 * iOS will not let a web app send push notifications unless it has been added
 * to the home screen (16.4+), and it offers no install prompt of its own — the
 * only route is Share → Add to Home Screen. So this explains it, twice, and then
 * never again.
 */
export function InstallSheet() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const platform = detectPlatform();
    if (!platform.isIOS || platform.isStandalone) return;
    // Over plain HTTP, adding to the home screen gets you a full-screen
    // bookmark and nothing else — promising notifications would be a lie.
    if (!window.isSecureContext) return;
    if (timesSeen(INSTALL_HINT_KEY) >= MAX_HINTS) return;
    // Let the board paint first; this is an aside, not the point of the screen.
    const id = window.setTimeout(() => {
      markSeen(INSTALL_HINT_KEY);
      setShow(true);
    }, 1200);
    return () => window.clearTimeout(id);
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
          aria-label="Add Tasq to your home screen"
        >
          <h2 className="type-headline">Put this on your home screen</h2>
          <p className="type-callout mt-1.5 text-[var(--text-secondary)]">
            It opens full screen, and it&apos;s the only way iPhone will let the board send you
            notifications.
          </p>
          <ol className="type-callout mt-3 flex flex-col gap-1.5 text-[var(--text-secondary)]">
            <li>
              1. Tap <ShareGlyph /> <strong className="text-[var(--text)]">Share</strong> at the
              bottom of Safari
            </li>
            <li>
              2. Scroll to <strong className="text-[var(--text)]">Add to Home Screen</strong>
            </li>
            <li>
              3. Tap <strong className="text-[var(--text)]">Add</strong>
            </li>
          </ol>
          <div className="mt-4 flex gap-2">
            <Button
              tone="quiet"
              grow
              onPress={() => {
                markDone(INSTALL_HINT_KEY);
                setShow(false);
              }}
            >
              Don&apos;t show again
            </Button>
            <Button tone="primary" grow onPress={() => setShow(false)}>
              Got it
            </Button>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

function ShareGlyph() {
  return (
    <svg
      width="13"
      height="16"
      viewBox="0 0 14 18"
      fill="none"
      aria-hidden="true"
      className="inline-block align-[-2px]"
      style={{ color: 'var(--accent)' }}
    >
      <path d="M7 1v10M7 1L4 4M7 1l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 7.5h-1v9h11v-9h-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
