'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/Button';
import { Rail } from '@/components/ui/Rail';
import type { RecurrencePatternInput } from '@/lib/board-types';
import { SPRING_SHEET } from '@/lib/motion';

const WEEKDAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
] as const;

const PATTERNS: ReadonlyArray<{ value: RecurrencePatternInput; label: string }> = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Certain days' },
  { value: 'monthly', label: 'Monthly' },
];

export interface RepeatState {
  pattern: RecurrencePatternInput;
  weekdays: number[];
  dayOfMonth: number;
  spawnTime: string;
}

export function RepeatControls({
  value,
  onChange,
}: {
  value: RepeatState;
  onChange: (next: RepeatState) => void;
}) {
  const toggleWeekday = (day: number) => {
    const next = value.weekdays.includes(day)
      ? value.weekdays.filter((d) => d !== day)
      : [...value.weekdays, day];
    onChange({ ...value, weekdays: next.sort() });
  };

  return (
    <div className="flex flex-col gap-3.5">
      <Rail className="flex gap-2 pb-1" label="How often">
        {PATTERNS.map((p) => (
          <Button
            key={p.value}
            tone={value.pattern === p.value ? 'primary' : 'secondary'}
            pill
            aria-pressed={value.pattern === p.value}
            onPress={() => onChange({ ...value, pattern: p.value })}
            className="shrink-0"
            style={value.pattern === p.value ? undefined : { background: 'var(--surface)' }}
          >
            {p.label}
          </Button>
        ))}
      </Rail>

      <AnimatePresence initial={false} mode="wait">
        {value.pattern === 'weekly' ? (
          <motion.div
            key="weekly"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING_SHEET}
            style={{ overflow: 'hidden' }}
          >
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => {
                const on = value.weekdays.includes(d.value);
                return (
                  <Button
                    key={d.value}
                    tone={on ? 'primary' : 'secondary'}
                    pill
                    aria-pressed={on}
                    onPress={() => toggleWeekday(d.value)}
                    className="px-3"
                    style={on ? undefined : { background: 'var(--surface)' }}
                  >
                    {d.label}
                  </Button>
                );
              })}
            </div>
          </motion.div>
        ) : null}

        {value.pattern === 'monthly' ? (
          <motion.div
            key="monthly"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING_SHEET}
            style={{ overflow: 'hidden' }}
          >
            <label htmlFor="day-of-month" className="type-caption block text-[var(--text-tertiary)]">
              Day of the month
            </label>
            <input
              id="day-of-month"
              type="number"
              min={1}
              max={31}
              value={value.dayOfMonth}
              onChange={(e) =>
                onChange({
                  ...value,
                  dayOfMonth: Math.min(31, Math.max(1, Number(e.target.value) || 1)),
                })
              }
              className="tap-target type-body mt-1.5 w-24 rounded-[var(--radius-control)] px-3.5"
              style={{ background: 'var(--surface-strong)', border: '1px solid var(--hairline)' }}
            />
            <p className="type-caption mt-2 text-[var(--text-tertiary)]">
              A 31st lands on the last day in shorter months.
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div>
        <label htmlFor="spawn-time" className="type-caption block text-[var(--text-tertiary)]">
          Appears at
        </label>
        <input
          id="spawn-time"
          type="time"
          value={value.spawnTime}
          onChange={(e) => onChange({ ...value, spawnTime: e.target.value })}
          className="tap-target type-body mt-1.5 rounded-[var(--radius-control)] px-3.5"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--hairline)' }}
        />
        <p className="type-caption mt-2 text-[var(--text-tertiary)]">
          Shop time. The task shows up on the board then, every time it repeats.
        </p>
      </div>
    </div>
  );
}
