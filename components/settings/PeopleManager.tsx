'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { usePress } from '@/lib/use-press';
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
  isFounder: boolean;
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
              <PersonRowButton
                open={open}
                onToggle={() => {
                  setExpanded(open ? null : p.id);
                  setConfirming(null);
                  setMessage(null);
                }}
              >
                <Avatar name={p.name} userId={p.id} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="type-headline block truncate">
                    {p.name}
                    {p.isSelf ? (
                      <span className="type-caption ml-2 text-[var(--text-tertiary)]">you</span>
                    ) : null}
                    {p.isFounder ? (
                      <span
                        className="type-caption ml-2 rounded-full px-2 py-0.5"
                        style={{
                          background: 'color-mix(in srgb, var(--accent) 18%, transparent)',
                          color: 'var(--accent)',
                        }}
                      >
                        owner
                      </span>
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
              </PersonRowButton>

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

                      {/* A role is a choice between two named things, not a
                          switch: "Admin off" never said what someone *is*. */}
                      <div>
                        <span className="type-label block pb-2 text-[var(--text-tertiary)]">
                          Role
                        </span>
                        <Segmented
                          label={`Role for ${p.name}`}
                          value={p.isAdmin ? 'admin' : 'crew'}
                          disabled={pending || p.isFounder}
                          onChange={(v) => run(() => setAdminAction(p.id, v === 'admin'))}
                          options={[
                            {
                              value: 'crew',
                              label: 'Crew',
                              hint: 'Does the work. Cannot set bounties or see the money.',
                            },
                            {
                              value: 'admin',
                              label: 'Admin',
                              hint: p.isFounder
                                ? 'The owner is always an admin.'
                                : 'Runs the board — people, tabs, bounties, history, access.',
                            },
                          ]}
                        />
                      </div>

                      <div className="flex flex-wrap gap-2 pt-0.5">
                        <Button
                          tone="secondary"
                          disabled={pending || !p.enrolled}
                          onPress={() => {
                            if (confirming === `pin-${p.id}`) run(() => resetPinAction(p.id));
                            else setConfirming(`pin-${p.id}`);
                          }}
                        >
                          {confirming === `pin-${p.id}` ? 'Tap again to reset PIN' : 'Reset PIN'}
                        </Button>

                        {!p.isSelf && !p.isFounder ? (
                          <Button
                            tone="danger"
                            disabled={pending}
                            onPress={() => {
                              if (confirming === `rm-${p.id}`) run(() => archiveUserAction(p.id));
                              else setConfirming(`rm-${p.id}`);
                            }}
                          >
                            {confirming === `rm-${p.id}`
                              ? 'Tap again to remove'
                              : 'Remove from board'}
                          </Button>
                        ) : null}
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
            placeholder="Their name"
            autoComplete="off"
            className="tap-target type-body w-full rounded-[var(--radius-control)] px-3.5"
            style={{
              background: 'var(--surface-strong)',
              border: '1px solid var(--hairline)',
            }}
          />
          <Segmented
            label="Role for the new person"
            value={newAdmin ? 'admin' : 'crew'}
            disabled={pending}
            onChange={(v) => setNewAdmin(v === 'admin')}
            options={[
              { value: 'crew', label: 'Crew', hint: 'Does the work.' },
              { value: 'admin', label: 'Admin', hint: 'Runs the board — people, money, access.' },
            ]}
          />
          <Button
            tone="primary"
            disabled={pending || newName.trim().length < 2}
            onPress={() =>
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
          </Button>
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

/** A full-width disclosure row. Presses as one surface, like a card. */
function PersonRowButton({
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
