'use client';

import { useId } from 'react';
import { motion } from 'motion/react';
import { usePress } from '@/lib/use-press';
import { SPRING_ENTER } from '@/lib/motion';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Shown under the control when this option is the one selected. */
  hint?: string;
}

/**
 * A pick-one control: every choice is on screen, and the selected one is a pill
 * that slides between them.
 *
 * This exists because most of what used to be a switch in this app was never a
 * switch. A switch says "this thing is on or off" and answers immediately; a
 * choice between named states ("Crew or Admin", "anyone or approved devices",
 * "due at a time or repeating") is a different question, and showing it as one
 * hides half the answer behind a knob position the reader has to interpret.
 * Here both words are visible and the pill says which one is true.
 *
 * The whole row is the target, so the labels are as tappable as any button —
 * important on a shop iPad being used with gloves on.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled = false,
  size = 'md',
}: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the group for screen readers — the options name themselves. */
  label: string;
  disabled?: boolean;
  /** `sm` fits inside a card row; `md` is the standalone default. */
  size?: 'sm' | 'md';
}) {
  // One layoutId per instance, or two segmented controls on the same screen
  // would animate their pills into each other.
  const pillId = useId();
  const hint = options.find((o) => o.value === value)?.hint;

  return (
    <div>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex w-full rounded-[var(--radius-control)] p-1"
        style={{
          background: 'var(--surface-strong)',
          border: '1px solid var(--hairline)',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {options.map((option) => (
          <Segment
            key={option.value}
            option={option}
            selected={option.value === value}
            disabled={disabled}
            pillId={pillId}
            size={size}
            onSelect={() => {
              if (option.value !== value) onChange(option.value);
            }}
          />
        ))}
      </div>
      {hint ? (
        <p className="type-caption mt-2 px-1 text-[var(--text-tertiary)]">{hint}</p>
      ) : null}
    </div>
  );
}

function Segment<T extends string>({
  option,
  selected,
  disabled,
  pillId,
  size,
  onSelect,
}: {
  option: SegmentOption<T>;
  selected: boolean;
  disabled: boolean;
  pillId: string;
  size: 'sm' | 'md';
  onSelect: () => void;
}) {
  const { pressed, handlers } = usePress(onSelect, disabled);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      {...handlers}
      data-pressed={pressed ? '' : undefined}
      className={`press-scale relative flex flex-1 items-center justify-center rounded-[calc(var(--radius-control)-3px)] ${
        size === 'sm' ? 'h-8 px-2' : 'tap-target px-3'
      }`}
    >
      {selected ? (
        <motion.span
          layoutId={pillId}
          transition={SPRING_ENTER}
          aria-hidden="true"
          className="absolute inset-0 rounded-[calc(var(--radius-control)-3px)]"
          style={{ background: 'var(--accent)' }}
        />
      ) : null}
      <span
        className="type-callout relative truncate"
        style={{
          color: selected ? 'var(--accent-ink)' : 'var(--text-secondary)',
          fontWeight: selected ? 600 : 500,
        }}
      >
        {option.label}
      </span>
    </button>
  );
}
