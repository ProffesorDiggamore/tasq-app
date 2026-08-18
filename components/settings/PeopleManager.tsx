'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import {
  archiveUserAction,
  createUserAction,
  renameUserAction,
  resetPinAction,
  setAdminAction,
} from '@/app/settings/actions';
import type { ActionResult } from '@/lib/action-result';
import { haptic } from '@/lib/haptics';
import { SPRING_ENTER, SPRING_SHEET } from '@/lib/motion';

export interface PersonRow {
  id: number;
  name: string;
  isAdmin: boolean;
  enrolled: boolean;
  isSelf: boolean;
}

export function PeopleManager({ people }: { people: PersonRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [newAdmin, setNewAdmin] = useState(false);
  /** Two-step confirm for the destructive ones, in place of a modal. */
  const [confirming, setConfirming] = useState<string | null>(null);

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
    <section>
      <h2 className="type-label px-1 text-[var(--text-tertiary)]">People</h2>

      <ul className="mt-2.5 flex flex-col gap-2">
        {people.map((p) => {
          const open = expanded === p.id;
          return (
            <li key={p.id} className="material-card overflow-hidden rounded-[var(--radius-card)]">
              <button
                type="button"
                onClick={() => {
                  setExpanded(open ? null : p.id);
                  setConfirming(null);
                  setMessage(null);
                }}
                aria-expanded={open}
                className="pressable tap-target flex w-full items-center gap-3.5 px-4 py-3.5 text-left"
              >
                <Avatar name={p.name} userId={p.id} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="type-headline block truncate">
                    {p.name}
                    {p.isSelf ? (
                      <span className="type-caption ml-2 text-[var(--text-tertiary)]">you</span>
                    ) : null}
                  </span>
                  <span className="type-caption block text-[var(--text-tertiary)]">
                    {p.isAdmin ? 'Admin' : 'Crew'} · {p.enrolled ? 'PIN set' : 'No PIN yet'}
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
              </button>

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
                        initial={p.name}
                        disabled={pending}
                        onSave={(name) => run(() => renameUserAction(p.id, name))}
                      />

                      <Row
                        label="Admin"
                        hint="Sees Supply Requests and full History."
                      >
                        <Toggle
                          checked={p.isAdmin}
                          disabled={pending}
                          label={`Admin access for ${p.name}`}
                          onChange={(v) => run(() => setAdminAction(p.id, v))}
                        />
                      </Row>

                      <div className="flex flex-wrap gap-2 pt-0.5">
                        <SecondaryButton
                          disabled={pending || !p.enrolled}
                          onClick={() => {
                            if (confirming === `pin-${p.id}`) run(() => resetPinAction(p.id));
                            else setConfirming(`pin-${p.id}`);
                          }}
                        >
                          {confirming === `pin-${p.id}` ? 'Tap again to reset PIN' : 'Reset PIN'}
                        </SecondaryButton>

                        {p.isSelf ? null : (
                          <SecondaryButton
                            danger
                            disabled={pending}
                            onClick={() => {
                              if (confirming === `rm-${p.id}`) run(() => archiveUserAction(p.id));
                              else setConfirming(`rm-${p.id}`);
                            }}
                          >
                            {confirming === `rm-${p.id}`
                              ? 'Tap again to remove'
                              : 'Remove from board'}
                          </SecondaryButton>
                        )}
                      </div>

                      <p className="type-caption text-[var(--text-tertiary)]">
                        Removing someone hides them from the board. Their tasks and history stay.
                      </p>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>

      <div className="material-card mt-4 rounded-[var(--radius-card)] p-4">
        <h3 className="type-headline">Add someone</h3>
        <div className="mt-3 flex flex-col gap-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name"
            autoComplete="off"
            className="tap-target type-body w-full rounded-[var(--radius-control)] px-3.5"
            style={{
              background: 'var(--surface-strong)',
              border: '1px solid var(--hairline)',
            }}
          />
          <Row label="Admin" hint="Sees Supply Requests and full History.">
            <Toggle
              checked={newAdmin}
              disabled={pending}
              label="New person is an admin"
              onChange={setNewAdmin}
            />
          </Row>
          <PrimaryButton
            disabled={pending || newName.trim().length < 2}
            onClick={() =>
              run(async () => {
                const result = await createUserAction(newName, newAdmin);
                if (result.ok) {
                  setNewName('');
                  setNewAdmin(false);
                }
                return result;
              })
            }
          >
            Add to board
          </PrimaryButton>
        </div>
      </div>

      <AnimatePresence>
        {message ? (
          <motion.p
            key={message}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={SPRING_ENTER}
            role="alert"
            className="type-callout mt-3 rounded-[var(--radius-control)] px-3.5 py-2.5"
            style={{
              background: 'color-mix(in srgb, var(--danger) 16%, transparent)',
              color: 'var(--danger)',
            }}
          >
            {message}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function NameField({
  initial,
  disabled,
  onSave,
}: {
  initial: string;
  disabled: boolean;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const dirty = value.trim() !== initial && value.trim().length >= 2;
  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Name"
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
            <PrimaryButton disabled={disabled} onClick={() => onSave(value)}>
              Save
            </PrimaryButton>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="min-w-0 flex-1">
        <span className="type-body block">{label}</span>
        {hint ? (
          <span className="type-caption block text-[var(--text-tertiary)]">{hint}</span>
        ) : null}
      </span>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative shrink-0 rounded-full disabled:opacity-50"
      style={{
        width: 51,
        height: 31,
        background: checked ? 'var(--success)' : 'var(--surface-pressed)',
        transition: 'background-color 160ms linear',
      }}
    >
      <motion.span
        className="absolute top-[2px] block rounded-full bg-white"
        style={{ width: 27, height: 27, boxShadow: '0 1px 3px rgb(0 0 0 / 0.3)' }}
        animate={{ x: checked ? 22 : 2 }}
        transition={SPRING_SHEET}
      />
    </button>
  );
}

function PrimaryButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="pressable tap-target type-headline rounded-[var(--radius-control)] px-4 disabled:opacity-40"
      style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  disabled,
  danger,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="pressable tap-target type-callout rounded-[var(--radius-control)] px-3.5 disabled:opacity-40"
      style={{
        background: 'var(--surface-strong)',
        border: '1px solid var(--hairline)',
        color: danger ? 'var(--danger)' : 'var(--text)',
      }}
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
