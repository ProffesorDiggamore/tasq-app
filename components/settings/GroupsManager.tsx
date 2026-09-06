'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/Button';
import { Rail } from '@/components/ui/Rail';
import { usePress } from '@/lib/use-press';
import {
  archiveGroupAction,
  createGroupAction,
  renameGroupAction,
  setGroupMembersAction,
} from '@/app/group-actions';
import type { ActionResult } from '@/lib/action-result';
import type { PersonSummary } from '@/lib/auth/results';
import { haptic } from '@/lib/haptics';
import { SPRING_ENTER, SPRING_SHEET } from '@/lib/motion';

export interface GroupRow {
  id: number;
  name: string;
  memberIds: number[];
}

/**
 * Admin-only. Tabs are made here, named here, and staffed here — the board
 * itself has no way to create one, which is the whole point of the feature:
 * crew post work into tabs, the owner decides what the tabs are.
 */
export function GroupsManager({
  groups,
  people,
}: {
  groups: GroupRow[];
  people: PersonSummary[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  /** Two-step confirm for the destructive one, in place of a modal. */
  const [confirming, setConfirming] = useState<number | null>(null);

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
      <div className="flex items-baseline gap-2 px-1">
        <h2 className="type-label text-[var(--text-tertiary)]">Tabs</h2>
        {groups.length > 0 ? (
          <span className="type-caption text-[var(--text-tertiary)]">tap to edit</span>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <p className="type-callout mt-2.5 px-1 text-[var(--text-tertiary)]">
          Everything is on one shared board. Add a tab to give part of the crew their own.
        </p>
      ) : (
        <ul className="mt-2.5 flex flex-col gap-2">
          {groups.map((g) => {
            const open = expanded === g.id;
            return (
              <li key={g.id} className="material-card overflow-hidden rounded-[var(--radius-card)]">
                <RowButton
                  open={open}
                  onToggle={() => {
                    setExpanded(open ? null : g.id);
                    setConfirming(null);
                    setMessage(null);
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="type-headline block truncate">{g.name}</span>
                    <span className="type-caption block text-[var(--text-tertiary)]">
                      {g.memberIds.length === 0
                        ? 'Nobody on it yet — admins only'
                        : `${g.memberIds.length} ${g.memberIds.length === 1 ? 'person' : 'people'}`}
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
                        className="flex flex-col gap-4 px-4 pb-4"
                        style={{ borderTop: '1px solid var(--hairline)', paddingTop: '0.875rem' }}
                      >
                        <NameField
                          initial={g.name}
                          disabled={pending}
                          onSave={(name) => run(() => renameGroupAction(g.id, name))}
                        />

                        <MemberPicker
                          people={people}
                          memberIds={g.memberIds}
                          disabled={pending}
                          onChange={(ids) => run(() => setGroupMembersAction(g.id, ids))}
                        />

                        <Button
                          tone="danger"
                          fullWidth
                          disabled={pending}
                          onPress={() => {
                            if (confirming === g.id) run(() => archiveGroupAction(g.id));
                            else setConfirming(g.id);
                          }}
                        >
                          {confirming === g.id ? 'Tap again to remove the tab' : 'Remove tab'}
                        </Button>

                        <p className="type-caption text-[var(--text-tertiary)]">
                          Removing a tab takes it off the board. The work that was on it stays in
                          History.
                        </p>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      )}

      <div className="material-card mt-4 rounded-[var(--radius-card)] p-4">
        <h3 className="type-headline">Add a tab</h3>
        <p className="type-caption mt-1 text-[var(--text-tertiary)]">
          Anyone you put on it can post and finish work there. Everyone else never sees it.
        </p>
        <div className="mt-3 flex flex-col gap-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value.slice(0, 32))}
            placeholder="Concrete Guys"
            aria-label="Tab name"
            autoComplete="off"
            className="tap-target type-body w-full rounded-[var(--radius-control)] px-3.5"
            style={{ background: 'var(--surface-strong)', border: '1px solid var(--hairline)' }}
          />
          <Button
            tone="primary"
            disabled={pending || newName.trim().length < 2}
            onPress={() =>
              run(async () => {
                const result = await createGroupAction(newName);
                if (result.ok) setNewName('');
                return result;
              })
            }
          >
            Add tab
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

/** Membership is a set, so it is edited as one: each tap saves immediately. */
function MemberPicker({
  people,
  memberIds,
  disabled,
  onChange,
}: {
  people: PersonSummary[];
  memberIds: number[];
  disabled: boolean;
  onChange: (ids: number[]) => void;
}) {
  const members = new Set(memberIds);
  return (
    <div>
      <span className="type-caption block px-1 text-[var(--text-tertiary)]">Who is on it</span>
      <Rail className="mt-2 flex gap-2 pb-1" label="Who is on it">
        {people.map((p) => {
          const on = members.has(p.id);
          return (
            <Button
              key={p.id}
              tone={on ? 'primary' : 'secondary'}
              pill
              aria-pressed={on}
              disabled={disabled}
              className="shrink-0"
              style={on ? undefined : { background: 'var(--surface)' }}
              onPress={() =>
                onChange(on ? memberIds.filter((id) => id !== p.id) : [...memberIds, p.id])
              }
            >
              <Avatar name={p.name} userId={p.id} size={24} />
              {p.name}
            </Button>
          );
        })}
      </Rail>
      <p className="type-caption mt-2 px-1 text-[var(--text-tertiary)]">
        Admins see every tab whether or not they are on it.
      </p>
    </div>
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
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const dirty = value.trim() !== initial && value.trim().length >= 2;
  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, 32))}
        aria-label="Tab name"
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
