'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { usePress } from '@/lib/use-press';
import {
  approveDeviceAction,
  blockDeviceAction,
  forgetDeviceAction,
  renameDeviceAction,
  revokeDeviceAction,
  setWhitelistEnabledAction,
} from '@/app/device-actions';
import type { ActionResult } from '@/lib/action-result';
import type { DeviceRow } from '@/lib/board-types';
import { haptic } from '@/lib/haptics';
import { SPRING_ENTER, SPRING_SHEET } from '@/lib/motion';
import { relativeTime } from '@/lib/time';

/**
 * The guest list. Waiting devices sit at the top because they are the only
 * thing on this screen that is a decision; approved ones are a record.
 */
export function DevicesScreen({
  enabled,
  waiting,
  approved,
  blocked,
  serverNow,
}: {
  enabled: boolean;
  waiting: DeviceRow[];
  approved: DeviceRow[];
  blocked: DeviceRow[];
  serverNow: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  function run(fn: () => Promise<ActionResult>) {
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        haptic('commit');
        router.refresh();
      } else {
        haptic('error');
        setMessage(result.message);
      }
    });
  }

  return (
    <main className="mx-auto w-full max-w-2xl pb-16" style={{ paddingInline: 'var(--gutter)' }}>
      {/* Two named states rather than a switch: "off" on a door policy is
          ambiguous in a way "Anyone with the link" is not. */}
      <section className="material-card rounded-[var(--radius-card)] p-4">
        <h2 className="type-headline">Who can reach this board</h2>
        <div className="mt-3">
          <Segmented
            label="Who can reach this board"
            value={enabled ? 'approved' : 'anyone'}
            disabled={pending}
            onChange={(v) => run(() => setWhitelistEnabledAction(v === 'approved'))}
            options={[
              {
                value: 'anyone',
                label: 'Anyone',
                hint: 'Anyone who can reach the address gets the sign-in screen. Worth changing once the board is published to the internet — on the shop network the front door is already the gate.',
              },
              {
                value: 'approved',
                label: 'Approved only',
                hint: 'A new phone or computer lands on a waiting screen and shows up here until you let it in. Switching to this approved the device you are holding.',
              },
            ]}
          />
        </div>
      </section>

      <Group
        title="Waiting"
        empty="Nobody is waiting."
        rows={waiting}
        serverNow={serverNow}
        expanded={expanded}
        setExpanded={setExpanded}
        pending={pending}
        run={run}
        primary={{ label: 'Let in', tone: 'primary', act: approveDeviceAction }}
        secondary={{ label: 'Block', tone: 'danger', act: blockDeviceAction }}
      />

      <Group
        title="Approved"
        empty="No devices approved yet."
        rows={approved}
        serverNow={serverNow}
        expanded={expanded}
        setExpanded={setExpanded}
        pending={pending}
        run={run}
        primary={{ label: 'Revoke', tone: 'danger', act: revokeDeviceAction }}
        secondary={{ label: 'Forget', tone: 'quiet', act: forgetDeviceAction }}
      />

      {blocked.length > 0 ? (
        <Group
          title="Blocked"
          empty=""
          rows={blocked}
          serverNow={serverNow}
          expanded={expanded}
          setExpanded={setExpanded}
          pending={pending}
          run={run}
          primary={{ label: 'Let in', tone: 'primary', act: approveDeviceAction }}
          secondary={{ label: 'Forget', tone: 'quiet', act: forgetDeviceAction }}
        />
      ) : null}

      <p className="type-caption mt-7 text-[var(--text-tertiary)]">
        A device is one browser on one machine. Clearing site data, a private window, or a second
        browser all count as a new one. If you ever lock yourself out of every device, run{' '}
        <span className="text-[var(--text)]">npm run devices</span> on the shop Mac.
      </p>

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

interface Act {
  label: string;
  tone: 'primary' | 'danger' | 'quiet';
  act: (deviceId: number) => Promise<ActionResult>;
}

function Group({
  title,
  empty,
  rows,
  serverNow,
  expanded,
  setExpanded,
  pending,
  run,
  primary,
  secondary,
}: {
  title: string;
  empty: string;
  rows: DeviceRow[];
  serverNow: number;
  expanded: number | null;
  setExpanded: (id: number | null) => void;
  pending: boolean;
  run: (fn: () => Promise<ActionResult>) => void;
  primary: Act;
  secondary: Act;
}) {
  return (
    <section className="mt-7">
      <div className="flex items-baseline gap-2 px-1">
        <h2 className="type-label text-[var(--text-tertiary)]">{title}</h2>
        {rows.length > 0 ? (
          <span className="type-caption text-[var(--text-tertiary)]">{rows.length}</span>
        ) : null}
      </div>

      {rows.length === 0 ? (
        empty ? (
          <p className="type-callout mt-2.5 px-1 text-[var(--text-tertiary)]">{empty}</p>
        ) : null
      ) : (
        <ul className="mt-2.5 flex flex-col gap-2">
          {rows.map((d) => {
            const open = expanded === d.id;
            return (
              <li key={d.id} className="material-card overflow-hidden rounded-[var(--radius-card)]">
                <RowButton open={open} onToggle={() => setExpanded(open ? null : d.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="type-headline block truncate">{d.label}</span>
                    <span className="type-caption block text-[var(--text-tertiary)]">
                      {d.lastUserName ? `${d.lastUserName} · ` : ''}seen{' '}
                      {relativeTime(d.lastSeenAt, serverNow)}
                    </span>
                  </span>
                  <motion.span
                    animate={{ rotate: open ? 90 : 0 }}
                    transition={SPRING_ENTER}
                    className="flex"
                    aria-hidden="true"
                  >
                    <Chevron />
                  </motion.span>
                </RowButton>

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
                        style={{ borderTop: '1px solid var(--hairline)', paddingTop: '0.875rem' }}
                      >
                        <NameField
                          initial={d.label}
                          disabled={pending}
                          onSave={(label) => run(() => renameDeviceAction(d.id, label))}
                        />
                        <p className="type-caption text-[var(--text-tertiary)]">
                          First seen {relativeTime(d.firstSeenAt, serverNow)}.
                        </p>
                        <div className="flex gap-2">
                          <Button
                            tone={primary.tone}
                            grow
                            disabled={pending}
                            onPress={() => run(() => primary.act(d.id))}
                          >
                            {primary.label}
                          </Button>
                          <Button
                            tone={secondary.tone}
                            grow
                            disabled={pending}
                            onPress={() => run(() => secondary.act(d.id))}
                          >
                            {secondary.label}
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function RowButton({
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

function NameField({
  initial,
  disabled,
  onSave,
}: {
  initial: string;
  disabled: boolean;
  onSave: (label: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const dirty = value.trim() !== initial && value.trim().length >= 2;
  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, 40))}
        aria-label="Device name"
        autoComplete="off"
        className="tap-target type-body min-w-0 flex-1 rounded-[var(--radius-control)] px-3.5"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--hairline)' }}
      />
      <AnimatePresence initial={false}>
        {dirty ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={SPRING_ENTER}
          >
            <Button tone="primary" disabled={disabled} onPress={() => onSave(value)}>
              Save
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
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
