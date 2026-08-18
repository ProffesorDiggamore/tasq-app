'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import { setRecurrenceActiveAction } from '@/app/recurrence-actions';
import type { RecurrenceSummary } from '@/lib/board-types';
import { haptic } from '@/lib/haptics';
import { SPRING_SHEET } from '@/lib/motion';

export function RecurrenceList({ rules }: { rules: RecurrenceSummary[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<number | null>(null);

  const toggle = useCallback(
    (rule: RecurrenceSummary) => {
      setBusy(rule.id);
      startTransition(async () => {
        const result = await setRecurrenceActiveAction(rule.id, !rule.active);
        setBusy(null);
        haptic(result.ok ? 'commit' : 'error');
        router.refresh();
      });
    },
    [router],
  );

  return (
    <section>
      <h2 className="type-label px-1 text-[var(--text-tertiary)]">Repeating tasks</h2>
      {rules.length === 0 ? (
        <p className="type-callout mt-2.5 px-1 text-[var(--text-tertiary)]">
          Nothing repeats yet. Turn on <span className="text-[var(--text)]">Repeats</span> when you
          add a task.
        </p>
      ) : (
        <ul className="mt-2.5 flex flex-col gap-2">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="material-card flex items-center gap-3 rounded-[var(--radius-card)] px-4 py-3"
              style={{ opacity: rule.active ? 1 : 0.55 }}
            >
              {rule.defaultAssignee !== null ? (
                <Avatar
                  name={rule.assigneeName ?? '?'}
                  userId={rule.defaultAssignee}
                  size={34}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="type-caption flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full"
                  style={{ background: 'var(--surface-strong)', color: 'var(--text-tertiary)' }}
                >
                  Any
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="type-headline truncate">
                  {rule.title}
                  {rule.isAsap ? (
                    <span
                      className="type-label ml-2 rounded-[var(--radius-pill)] px-1.5 py-0.5"
                      style={{ background: 'var(--asap)', color: 'var(--asap-ink)' }}
                    >
                      ASAP
                    </span>
                  ) : null}
                </p>
                <p className="type-caption truncate text-[var(--text-tertiary)]">
                  {rule.schedule}
                  {rule.assigneeName ? ` · ${rule.assigneeName}` : ' · up for grabs'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={rule.active}
                aria-label={`${rule.title} is ${rule.active ? 'on' : 'paused'}`}
                disabled={busy === rule.id}
                onClick={() => toggle(rule)}
                className="relative shrink-0 rounded-full disabled:opacity-50"
                style={{
                  width: 51,
                  height: 31,
                  background: rule.active ? 'var(--success)' : 'var(--surface-pressed)',
                  transition: 'background-color 160ms linear',
                }}
              >
                <motion.span
                  className="absolute top-[2px] block rounded-full bg-white"
                  style={{ width: 27, height: 27, boxShadow: '0 1px 3px rgb(0 0 0 / 0.3)' }}
                  animate={{ x: rule.active ? 22 : 2 }}
                  transition={SPRING_SHEET}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
