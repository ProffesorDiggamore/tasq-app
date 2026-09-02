'use client';

import { motion } from 'motion/react';
import { usePress } from '@/lib/use-press';
import { SPRING_ENTER } from '@/lib/motion';

/**
 * A tick box with its label, pressed as one row.
 *
 * For the third kind of question the app asks — not "is this system on" (a
 * switch) and not "which of these" (a segmented control), but "include this
 * or not" while filling something in. A form option is not a live setting: it
 * does nothing until Save, and a switch that animates as though it did was
 * quietly lying about that.
 *
 * The whole row is the target, and the box is 24px rather than the usual
 * hairline-thin checkbox, because this gets used on a shop iPad.
 */
export function CheckRow({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  const { pressed, handlers } = usePress(() => onChange(!checked), disabled);

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      {...handlers}
      data-pressed={pressed ? '' : undefined}
      className="press-surface tap-target -mx-1 flex w-full items-center gap-3 rounded-[var(--radius-control)] px-1 py-1 text-left disabled:opacity-50"
    >
      <Box checked={checked} />
      <span className="min-w-0 flex-1">
        <span className="type-body block">{label}</span>
        {hint ? (
          <span className="type-caption block text-[var(--text-tertiary)]">{hint}</span>
        ) : null}
      </span>
    </button>
  );
}

function Box({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px]"
      style={{
        background: checked ? 'var(--accent)' : 'var(--surface-strong)',
        border: `1px solid ${checked ? 'var(--accent)' : 'var(--hairline)'}`,
        transition: 'background-color 140ms linear, border-color 140ms linear',
      }}
    >
      <motion.svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        initial={false}
        animate={{ scale: checked ? 1 : 0.4, opacity: checked ? 1 : 0 }}
        transition={SPRING_ENTER}
      >
        <path
          d="M2.5 7.5L5.5 10.5L11.5 3.5"
          stroke="var(--accent-ink)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </motion.svg>
    </span>
  );
}
