'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/Button';
import { Rail } from '@/components/ui/Rail';
import { RepeatControls, type RepeatState } from '@/components/board/RepeatControls';
import {
  deleteRecurrenceAction,
  setRecurrenceActiveAction,
  updateRecurrenceAction,
} from '@/app/recurrence-actions';
import type { PersonSummary } from '@/lib/auth/results';
import type { RecurrenceSummary } from '@/lib/board-types';
import type { ActionResult } from '@/lib/action-result';
import { usePress } from '@/lib/use-press';
import { haptic } from '@/lib/haptics';
import { SPRING_ENTER, SPRING_SHEET } from '@/lib/motion';

function toRepeatState(rule: RecurrenceSummary): RepeatState {
  return {
    pattern: rule.pattern,
    weekdays: (rule.weekdays ?? '')
      .split(',')
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
    dayOfMonth: rule.dayOfMonth ?? 1,
    spawnTime: rule.spawnTime,
  };
}

export function RecurrenceList({
  rules,
  people,
  viewerId,
}: {
  rules: RecurrenceSummary[];
  people: PersonSummary[];
  viewerId: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(
    (id: number, fn: () => Promise<ActionResult>, onOk?: () => void) => {
      setBusy(id);
      setMessage(null);
      startTransition(async () => {
        const result = await fn();
        setBusy(null);
        if (result.ok) {
          haptic('commit');
          onOk?.();
          router.refresh();
        } else {
          haptic('error');
          setMessage(result.message);
        }
      });
    },
    [router],
  );

  return (
    <section>
      <div className="flex items-baseline gap-2 px-1">
        <h2 className="type-label text-[var(--text-tertiary)]">Repeating tasks</h2>
        {rules.length > 0 ? (
          <span className="type-caption text-[var(--text-tertiary)]">tap to edit</span>
        ) : null}
      </div>

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
              className="material-card overflow-hidden rounded-[var(--radius-card)]"
              style={{ opacity: rule.active || editing === rule.id ? 1 : 0.55 }}
            >
              <RuleRow
                rule={rule}
                open={editing === rule.id}
                busy={busy === rule.id}
                onToggleOpen={() => {
                  setEditing(editing === rule.id ? null : rule.id);
                  setMessage(null);
                }}
                onToggleActive={() =>
                  run(rule.id, () => setRecurrenceActiveAction(rule.id, !rule.active))
                }
              />

              <AnimatePresence initial={false}>
                {editing === rule.id ? (
                  <motion.div
                    key="editor"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={SPRING_SHEET}
                    style={{ overflow: 'hidden' }}
                  >
                    <RuleEditor
                      rule={rule}
                      people={people}
                      viewerId={viewerId}
                      busy={busy === rule.id}
                      onCancel={() => setEditing(null)}
                      onSave={(input) =>
                        run(rule.id, () => updateRecurrenceAction(rule.id, input), () =>
                          setEditing(null),
                        )
                      }
                      onDelete={() =>
                        run(rule.id, () => deleteRecurrenceAction(rule.id), () => setEditing(null))
                      }
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </li>
          ))}
        </ul>
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

function RuleRow({
  rule,
  open,
  busy,
  onToggleOpen,
  onToggleActive,
}: {
  rule: RecurrenceSummary;
  open: boolean;
  busy: boolean;
  onToggleOpen: () => void;
  onToggleActive: () => void;
}) {
  const { pressed, handlers } = usePress(onToggleOpen);
  return (
    <div className="flex items-center">
      <button
        type="button"
        {...handlers}
        aria-expanded={open}
        data-pressed={pressed ? '' : undefined}
        className="press-surface tap-target flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
      >
        {rule.defaultAssignee !== null ? (
          <Avatar name={rule.assigneeName ?? '?'} userId={rule.defaultAssignee} size={34} />
        ) : (
          <span
            aria-hidden="true"
            className="type-caption flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full"
            style={{ background: 'var(--surface-strong)', color: 'var(--text-tertiary)' }}
          >
            Any
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="type-headline block truncate">
            {rule.title}
            {rule.isAsap ? (
              <span
                className="type-label ml-2 rounded-[var(--radius-pill)] px-1.5 py-0.5"
                style={{ background: 'var(--asap)', color: 'var(--asap-ink)' }}
              >
                ASAP
              </span>
            ) : null}
          </span>
          <span className="type-caption block truncate text-[var(--text-tertiary)]">
            {rule.schedule}
            {rule.assigneeName ? ` · ${rule.assigneeName}` : ' · up for grabs'}
            {rule.active ? '' : ' · paused'}
          </span>
        </span>
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={SPRING_ENTER} className="flex">
          <Chevron />
        </motion.span>
      </button>

      <button
        type="button"
        role="switch"
        aria-checked={rule.active}
        aria-label={`${rule.title} is ${rule.active ? 'on' : 'paused'}`}
        disabled={busy}
        onClick={onToggleActive}
        className="relative mr-4 shrink-0 rounded-full disabled:opacity-50"
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
    </div>
  );
}

function RuleEditor({
  rule,
  people,
  viewerId,
  busy,
  onCancel,
  onSave,
  onDelete,
}: {
  rule: RecurrenceSummary;
  people: PersonSummary[];
  viewerId: number;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: {
    title: string;
    notes: string;
    defaultAssignee: number | null;
    isAsap: boolean;
    pattern: RepeatState['pattern'];
    weekdays: number[];
    dayOfMonth: number | null;
    spawnTime: string;
  }) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(rule.title);
  const [notes, setNotes] = useState(rule.notes ?? '');
  const [assignee, setAssignee] = useState<number | null>(rule.defaultAssignee);
  const [isAsap, setIsAsap] = useState(rule.isAsap);
  const [repeat, setRepeat] = useState<RepeatState>(toRepeatState(rule));
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      className="flex flex-col gap-4 px-4 pb-4"
      style={{ borderTop: '1px solid var(--hairline)', paddingTop: '0.875rem' }}
    >
      <div>
        <label className="type-caption block text-[var(--text-tertiary)]" htmlFor={`t-${rule.id}`}>
          What it says
        </label>
        <input
          id={`t-${rule.id}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="tap-target type-body mt-1.5 w-full rounded-[var(--radius-control)] px-3.5"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--hairline)' }}
        />
      </div>

      <div>
        <label className="type-caption block text-[var(--text-tertiary)]" htmlFor={`n-${rule.id}`}>
          Details
        </label>
        <textarea
          id={`n-${rule.id}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="type-body mt-1.5 w-full rounded-[var(--radius-control)] px-3.5 py-2.5"
          style={{
            background: 'var(--surface-strong)',
            border: '1px solid var(--hairline)',
            resize: 'vertical',
          }}
        />
      </div>

      <div>
        <span className="type-caption block text-[var(--text-tertiary)]">Who it goes to</span>
        <Rail className="mt-1.5 flex gap-2 pb-1" label="Who it goes to">
          <Button
            tone={assignee === null ? 'primary' : 'secondary'}
            pill
            aria-pressed={assignee === null}
            onPress={() => setAssignee(null)}
            className="shrink-0"
            style={assignee === null ? undefined : { background: 'var(--surface)' }}
          >
            Anyone
          </Button>
          {people.map((p) => (
            <Button
              key={p.id}
              tone={assignee === p.id ? 'primary' : 'secondary'}
              pill
              aria-pressed={assignee === p.id}
              onPress={() => setAssignee(p.id)}
              className="shrink-0"
              style={assignee === p.id ? undefined : { background: 'var(--surface)' }}
            >
              <Avatar name={p.name} userId={p.id} size={22} />
              {p.id === viewerId ? `${p.name} (you)` : p.name}
            </Button>
          ))}
        </Rail>
      </div>

      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="type-body block">ASAP</span>
          <span className="type-caption block text-[var(--text-tertiary)]">
            Every copy lands on the shared ASAP row.
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={isAsap}
          aria-label="ASAP"
          onClick={() => setIsAsap(!isAsap)}
          className="relative shrink-0 rounded-full"
          style={{
            width: 51,
            height: 31,
            background: isAsap ? 'var(--success)' : 'var(--surface-pressed)',
            transition: 'background-color 160ms linear',
          }}
        >
          <motion.span
            className="absolute top-[2px] block rounded-full bg-white"
            style={{ width: 27, height: 27, boxShadow: '0 1px 3px rgb(0 0 0 / 0.3)' }}
            animate={{ x: isAsap ? 22 : 2 }}
            transition={SPRING_SHEET}
          />
        </button>
      </div>

      <div style={{ borderTop: '1px solid var(--hairline)' }} />

      <RepeatControls value={repeat} onChange={setRepeat} />

      <p className="type-caption text-[var(--text-tertiary)]">
        Copies already on the board keep what they say now — only the next one changes.
      </p>

      <div className="flex gap-2">
        <Button tone="quiet" grow disabled={busy} onPress={onCancel}>
          Cancel
        </Button>
        <Button
          tone="primary"
          grow
          disabled={busy || title.trim().length === 0}
          onPress={() =>
            onSave({
              title,
              notes,
              defaultAssignee: assignee,
              isAsap,
              pattern: repeat.pattern,
              weekdays: repeat.weekdays,
              dayOfMonth: repeat.pattern === 'monthly' ? repeat.dayOfMonth : null,
              spawnTime: repeat.spawnTime,
            })
          }
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <Button
        tone="danger"
        fullWidth
        disabled={busy}
        onPress={() => {
          if (confirmDelete) onDelete();
          else setConfirmDelete(true);
        }}
      >
        {confirmDelete ? 'Tap again to delete it' : 'Delete this repeating task'}
      </Button>
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
      <path d="M1 1l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
