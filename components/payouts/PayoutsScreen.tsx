'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/Button';
import { SuccessCheck } from '@/components/ui/SuccessCheck';
import { usePress } from '@/lib/use-press';
import { markPersonPaidAction, markTaskPaidAction } from '@/app/payout-actions';
import type { ActionResult } from '@/lib/action-result';
import type { PayoutPerson } from '@/lib/board-types';
import { haptic } from '@/lib/haptics';
import { SPRING_ENTER, SPRING_SHEET } from '@/lib/motion';
import { relativeTime } from '@/lib/time';

/** Whole dollars stay whole — "$25", not "$25.00". Mirrors lib/payouts.ts. */
function money(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/**
 * What the shop still owes, and nothing else.
 *
 * Anyone who is square simply is not here — no zero rows, no "paid" column to
 * read past. Settling a person removes them from the list on the next render,
 * so the screen empties as the debts are cleared and an empty screen is the
 * whole status report.
 */
export function PayoutsScreen({
  people,
  serverNow,
}: {
  people: PayoutPerson[];
  serverNow: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const total = people.reduce((sum, p) => sum + p.cents, 0);

  function run(fn: () => Promise<ActionResult>) {
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        haptic('commit');
        setConfirming(null);
        router.refresh();
      } else {
        haptic('error');
        setMessage(result.message);
      }
    });
  }

  return (
    <main className="mx-auto w-full max-w-2xl pb-16" style={{ paddingInline: 'var(--gutter)' }}>
      {people.length === 0 ? (
        <section className="flex flex-col items-center pt-16 text-center">
          <SuccessCheck size={64} label="All settled" />
          <h2 className="type-headline mt-5">All settled</h2>
          <p className="type-callout mt-1.5 text-[var(--text-secondary)]">
            Nobody is owed anything. Finished tasks with a bounty land here until you mark them
            paid.
          </p>
        </section>
      ) : (
        <>
          <section className="material-card rounded-[var(--radius-card)] p-4">
            <span className="type-label text-[var(--text-tertiary)]">Outstanding</span>
            <p className="type-display tabular mt-1" style={{ color: 'var(--accent)' }}>
              {money(total)}
            </p>
            <p className="type-callout mt-1 text-[var(--text-secondary)]">
              across {people.length} {people.length === 1 ? 'person' : 'people'}
            </p>
          </section>

          <ul className="mt-5 flex flex-col gap-2">
            {people.map((p) => {
              const open = expanded === p.userId;
              return (
                <li
                  key={p.userId}
                  className="material-card overflow-hidden rounded-[var(--radius-card)]"
                >
                  <PersonButton
                    open={open}
                    onToggle={() => {
                      setExpanded(open ? null : p.userId);
                      setConfirming(null);
                      setMessage(null);
                    }}
                  >
                    <Avatar name={p.name} userId={p.userId} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="type-headline block truncate">{p.name}</span>
                      <span className="type-caption block text-[var(--text-tertiary)]">
                        {p.taskCount} {p.taskCount === 1 ? 'task' : 'tasks'} · oldest{' '}
                        {relativeTime(p.oldestAt, serverNow)}
                      </span>
                    </span>
                    <span
                      className="type-headline tabular shrink-0"
                      style={{ color: 'var(--accent)' }}
                    >
                      {money(p.cents)}
                    </span>
                    <motion.span
                      animate={{ rotate: open ? 90 : 0 }}
                      transition={SPRING_ENTER}
                      className="flex"
                      aria-hidden="true"
                    >
                      <Chevron />
                    </motion.span>
                  </PersonButton>

                  <AnimatePresence initial={false}>
                    {open ? (
                      <motion.div
                        key="detail"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={SPRING_SHEET}
                        style={{ overflow: 'hidden' }}
                      >
                        <div
                          className="flex flex-col gap-3 px-4 pb-4"
                          style={{
                            borderTop: '1px solid var(--hairline)',
                            paddingTop: '0.875rem',
                          }}
                        >
                          <ul className="flex flex-col gap-2">
                            {p.tasks.map((t) => (
                              <li key={t.id} className="flex items-center gap-3">
                                <span className="min-w-0 flex-1">
                                  <span className="type-body block truncate">{t.title}</span>
                                  <span className="type-caption block text-[var(--text-tertiary)]">
                                    finished {relativeTime(t.completedAt, serverNow)}
                                  </span>
                                </span>
                                <span className="type-callout tabular shrink-0">
                                  {money(t.rewardCents)}
                                </span>
                                <Button
                                  tone="secondary"
                                  disabled={pending}
                                  onPress={() => run(() => markTaskPaidAction(t.id))}
                                >
                                  Paid
                                </Button>
                              </li>
                            ))}
                          </ul>

                          <Button
                            tone="primary"
                            fullWidth
                            disabled={pending}
                            onPress={() => {
                              if (confirming === p.userId) {
                                run(() => markPersonPaidAction(p.userId));
                              } else {
                                setConfirming(p.userId);
                              }
                            }}
                          >
                            {confirming === p.userId
                              ? `Tap again — paid ${p.name} ${money(p.cents)}`
                              : `Mark ${money(p.cents)} paid`}
                          </Button>

                          <p className="type-caption text-[var(--text-tertiary)]">
                            Marking paid records it in History. Tasq does not move any money — hand
                            over cash, Venmo them, or put it on their check as usual.
                          </p>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <AnimatePresence>
        {message ? (
          <motion.p
            key={message}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={SPRING_ENTER}
            role="alert"
            className="type-callout mt-4 rounded-[var(--radius-control)] px-3.5 py-2.5"
            style={{
              background: 'color-mix(in srgb, var(--danger) 16%, transparent)',
              color: 'var(--danger)',
            }}
          >
            {message}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </main>
  );
}

function PersonButton({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const { pressed, handlers } = usePress(onToggle);
  return (
    <button
      type="button"
      {...handlers}
      aria-expanded={open}
      data-pressed={pressed ? '' : undefined}
      className="press-surface tap-target flex w-full items-center gap-3.5 px-4 py-3.5 text-left"
    >
      {children}
    </button>
  );
}

function Chevron() {
  return (
    <svg
      width="8"
      height="14"
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
