'use client';

import { AnimatePresence, motion } from 'motion/react';
import { SPRING_SHEET } from '@/lib/motion';

export interface ToastMessage {
  /** Bumped per message so two identical texts still re-announce. */
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
}

export function Toast({ message }: { message: ToastMessage | null }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)]">
      <AnimatePresence>
        {message ? (
          <motion.p
            key={message.id}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={SPRING_SHEET}
            role="status"
            aria-live="polite"
            className="material-chrome type-callout max-w-sm rounded-[var(--radius-pill)] px-4 py-2.5 text-center"
            style={{
              border: '1px solid var(--hairline)',
              color: message.tone === 'error' ? 'var(--danger)' : 'var(--text)',
              boxShadow: 'var(--shadow-card)',
            }}
          >
            {message.tone === 'success' ? (
              // The completion micro-reward: a check that pops in ahead of the
              // words. Keyed with the message so every completion gets its own
              // pop; scale-only, so it stays legible even if motion never runs.
              <motion.span
                key={message.id}
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={SPRING_SHEET}
                className="mr-1.5 inline-block align-[-3px]"
                aria-hidden="true"
              >
                <CheckGlyph />
              </motion.span>
            ) : null}
            {message.text}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function CheckGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M2 7.5l3.2 3.2L12 4"
        stroke="var(--success)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
