'use client';

import { useCallback, useState, useTransition } from 'react';
import { CheckRow } from '@/components/ui/CheckRow';
import { setNotifyRuleAction } from '@/app/settings/actions';
import { NOTIFY_EVENTS, type NotifyEventKey, type NotifyPolicy } from '@/lib/notify-events';
import { haptic } from '@/lib/haptics';

/**
 * What sets the crew's phones off, as the admin chooses it.
 *
 * Board-wide rather than per person: five people on a small crew want the same
 * answer, and the admin is the one who hears about it when a phone buzzes at
 * six in the morning. Each row commits on its own — there is no Save — so a
 * switch that does not stick says so immediately instead of at the end.
 */
export function NotifyRules({ policy }: { policy: NotifyPolicy }) {
  const [rules, setRules] = useState<NotifyPolicy>(policy);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const toggle = useCallback((event: NotifyEventKey, next: boolean) => {
    setMessage(null);
    haptic('tap');
    // Moves under the finger, then gets put back if the board disagrees.
    setRules((current) => ({ ...current, [event]: next }));
    startTransition(async () => {
      try {
        const result = await setNotifyRuleAction(event, next);
        if (result.ok) return;
        setRules((current) => ({ ...current, [event]: !next }));
        setMessage(result.message);
      } catch {
        setRules((current) => ({ ...current, [event]: !next }));
        setMessage("That didn't save — check the connection and try again.");
      }
    });
  }, []);

  return (
    <section className="mt-7">
      <h2 className="type-label px-1 text-[var(--text-tertiary)]">What sends a notification</h2>
      <div className="material-card mt-2.5 rounded-[var(--radius-card)] p-4">
        <p className="type-callout text-[var(--text-secondary)]">
          Board-wide, for everyone. Turning one off stops that buzz for the whole crew — the board
          itself still shows everything.
        </p>

        <div className="mt-3 flex flex-col gap-2.5">
          {NOTIFY_EVENTS.map((event) => (
            <CheckRow
              key={event.key}
              checked={rules[event.key]}
              onChange={(next) => toggle(event.key, next)}
              label={event.label}
              hint={event.hint}
            />
          ))}
        </div>

        {message ? (
          <p
            className="type-callout mt-3 rounded-[var(--radius-control)] px-3.5 py-2.5"
            style={{
              background: 'color-mix(in srgb, var(--danger) 16%, transparent)',
              color: 'var(--danger)',
            }}
            role="alert"
          >
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
