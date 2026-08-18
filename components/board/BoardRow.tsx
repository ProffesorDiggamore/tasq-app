'use client';

import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { SPRING_ENTER, SPRING_SHEET } from '@/lib/motion';

export interface BoardRowProps {
  title: string;
  /** Shown as a pill beside the title. Omitted when zero. */
  badge?: number;
  accent?: 'asap' | 'default';
  /** Done Today starts closed — it is a record, not a to-do. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  emptyMessage?: string;
  count: number;
  children: ReactNode;
}

export function BoardRow({
  title,
  badge = 0,
  accent = 'default',
  collapsible = false,
  defaultOpen = true,
  emptyMessage,
  count,
  children,
}: BoardRowProps) {
  const [open, setOpen] = useState(defaultOpen);
  const isEmpty = count === 0;
  const showRail = !collapsible || open;

  const heading = (
    <>
      <h2
        className="type-label"
        style={{ color: accent === 'asap' ? 'var(--asap)' : 'var(--text-tertiary)' }}
      >
        {title}
      </h2>
      {badge > 0 ? (
        <motion.span
          // Keyed on the number so a change re-runs the pop — the badge is the
          // only signal for anyone who turned notifications down. It animates
          // scale only: a count this important has to be legible even if the
          // animation never runs, so full opacity is its resting state.
          key={badge}
          initial={{ scale: 0.72 }}
          animate={{ scale: 1 }}
          transition={SPRING_ENTER}
          className="type-caption tabular flex h-5 min-w-5 items-center justify-center rounded-[var(--radius-pill)] px-1.5"
          style={{
            background: accent === 'asap' ? 'var(--asap)' : 'var(--accent)',
            color: accent === 'asap' ? 'var(--asap-ink)' : 'var(--accent-ink)',
            fontWeight: 700,
          }}
          aria-label={`${badge} needing attention`}
        >
          {badge}
        </motion.span>
      ) : null}
    </>
  );

  return (
    <section className="mt-7 first:mt-2">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="pressable tap-target -ml-1 flex items-center gap-2 rounded-[var(--radius-control)] px-1"
        >
          {heading}
          <span className="type-caption text-[var(--text-tertiary)]">{count}</span>
          <motion.span animate={{ rotate: open ? 90 : 0 }} transition={SPRING_ENTER} className="flex">
            <Chevron />
          </motion.span>
        </button>
      ) : (
        <div className="flex items-center gap-2 px-1">{heading}</div>
      )}

      <AnimatePresence initial={false}>
        {showRail ? (
          <motion.div
            key="rail"
            initial={collapsible ? { height: 0, opacity: 0 } : false}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING_SHEET}
            style={{ overflow: collapsible ? 'hidden' : undefined }}
          >
            {isEmpty && emptyMessage ? (
              <p className="type-callout mt-2.5 px-1 text-[var(--text-tertiary)]">{emptyMessage}</p>
            ) : (
              <div
                className="rail mt-2.5 flex gap-3 pb-1"
                style={{
                  scrollSnapType: 'x proximity',
                  // Bleed to the screen edges so a card can sit under the edge
                  // and read as "there is more this way".
                  marginInline: 'calc(var(--gutter) * -1)',
                  paddingInline: 'var(--gutter)',
                  scrollPaddingInline: 'var(--gutter)',
                }}
              >
                {children}
              </div>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function Chevron() {
  return (
    <svg
      width="7"
      height="12"
      viewBox="0 0 8 14"
      fill="none"
      aria-hidden="true"
      style={{ color: 'var(--text-tertiary)' }}
    >
      <path
        d="M1 1l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
