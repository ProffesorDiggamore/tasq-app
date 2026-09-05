'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CountUp } from '@/components/analytics/CountUp';
import { usePress } from '@/lib/use-press';
import { haptic } from '@/lib/haptics';
import { SPRING_ENTER } from '@/lib/motion';

/**
 * One number, and the sentence behind it.
 *
 * The tile shows the figure; tapping it opens the explanation of where the
 * figure came from. Numbers on a dashboard are only encouraging if they are
 * trusted, and the fastest way to be trusted is to say plainly what was
 * counted — but saying it under every tile all the time turns the screen into
 * a page of small print, so it lives one tap away.
 */
export function StatTile({
  label,
  value,
  format,
  suffix,
  delta,
  detail,
  tone = 'default',
  index = 0,
}: {
  label: string;
  /** The number itself, so it can count up. Pass a formatter for money or a percent. */
  value: number;
  format?: (n: number) => string;
  suffix?: string;
  /** Change against the window before this one. Positive is not always good — see `tone`. */
  delta?: { pct: number; goodWhenUp: boolean } | null;
  detail: string;
  tone?: 'default' | 'accent' | 'asap';
  /** Stagger position, so a grid of these fills in rather than snapping on. */
  index?: number;
}) {
  const [open, setOpen] = useState(false);
  const { pressed, handlers } = usePress(() => {
    haptic('tap');
    setOpen((o) => !o);
  });

  const colour =
    tone === 'accent' ? 'var(--accent)' : tone === 'asap' ? 'var(--asap)' : 'var(--text)';

  return (
    <motion.button
      type="button"
      layout
      {...handlers}
      data-pressed={pressed ? '' : undefined}
      aria-expanded={open}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING_ENTER, delay: Math.min(index, 8) * 0.045 }}
      className="press material-card flex flex-col items-start rounded-[var(--radius-card)] p-3.5 text-left"
    >
      <span className="type-label text-[var(--text-tertiary)]">{label}</span>

      <span className="mt-1 flex w-full items-baseline gap-1.5">
        <CountUp
          value={value}
          format={format}
          className="type-title tabular"
          style={{ color: colour, fontWeight: 700 }}
        />
        {suffix ? (
          <span className="type-caption text-[var(--text-tertiary)]">{suffix}</span>
        ) : null}
        {delta ? <DeltaChip pct={delta.pct} goodWhenUp={delta.goodWhenUp} /> : null}
      </span>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.span
            key="detail"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING_ENTER}
            className="type-caption block overflow-hidden text-[var(--text-secondary)]"
          >
            <span className="block pt-2">{detail}</span>
          </motion.span>
        ) : null}
      </AnimatePresence>
    </motion.button>
  );
}

/**
 * The change against the window before. Sign is a fact; colour is a judgement,
 * so the caller says which direction counts as good — more Tasqs done is up,
 * more overdue is not.
 */
export function DeltaChip({ pct, goodWhenUp }: { pct: number; goodWhenUp: boolean }) {
  if (pct === 0) return null;
  const up = pct > 0;
  const good = up === goodWhenUp;
  const colour = good ? 'var(--success)' : 'var(--danger)';
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ ...SPRING_ENTER, delay: 0.5 }}
      className="type-caption tabular ml-auto flex shrink-0 items-center gap-0.5 rounded-[var(--radius-pill)] px-1.5 py-0.5"
      style={{
        background: `color-mix(in srgb, ${colour} 16%, transparent)`,
        color: colour,
        fontWeight: 650,
      }}
    >
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
        <path
          d={up ? 'M4 1 L7.5 6.5 L0.5 6.5 Z' : 'M4 7 L0.5 1.5 L7.5 1.5 Z'}
          fill="currentColor"
        />
      </svg>
      {Math.abs(pct)}%<span className="sr-only">{up ? ' more than' : ' less than'} last time</span>
    </motion.span>
  );
}
