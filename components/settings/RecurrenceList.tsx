'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/Button';
import { CheckRow } from '@/components/ui/CheckRow';
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
import { parseRewardInput } from '@/components/board/NewTaskForm';

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
  canSetReward,
}: {
  rules: RecurrenceSummary[];
  people: PersonSummary[];
  viewerId: number;
  /** A bounty is spending, so the field is the admin's alone. */
  canSetReward: boolean;
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
          Nothing repeats yet. Turn on <span className="text-[var(--text)]">Repeats</span> when adding a task.
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
                      canSetReward={canSetReward}
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

      {/* A rule is running or paused — a word says that; a knob position has
          to be decoded. Tapping it flips the state, same as the switch did. */}
      <StatusPill active={rule.active} busy={busy} title={rule.title} onPress={onToggleActive} />
    </div>
  );
}

/** Reads as a label, works as a button. */
function StatusPill({
  active,
  busy,
  title,
  onPress,
}: {
  active: boolean;
  busy: boolean;
  title: string;
  onPress: () => void;
}) {
  const { pressed, handlers } = usePress(onPress, busy);
  return (
    <button
      type="button"
      {...handlers}
      disabled={busy}
      data-pressed={pressed ? '' : undefined}
      aria-label={`${title} is ${active ? 'running' : 'paused'} — tap to ${active ? 'pause' : 'resume'}`}
      className="press-scale type-caption mr-3 shrink-0 rounded-[var(--radius-pill)] px-2.5 py-1 disabled:opacity-50"
      style={{
        background: active
          ? 'color-mix(in srgb, var(--success) 18%, transparent)'
          : 'var(--surface-strong)',
        color: active ? 'var(--success)' : 'var(--text-tertiary)',
        border: `1px solid ${active ? 'transparent' : 'var(--hairline)'}`,
        fontWeight: 600,
      }}
    >
      {active ? 'On' : 'Paused'}
    </button>
  );
}

function RuleEditor({
  rule,
  people,
  viewerId,
  canSetReward,
  busy,
  onCancel,
  onSave,
  onDelete,
}: {
  rule: RecurrenceSummary;
  people: PersonSummary[];
  viewerId: number;
  canSetReward: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: {
    title: string;
    notes: string;
    defaultAssignee: number | null;
    groupId: number | null;
    isAsap: boolean;
    pattern: RepeatState['pattern'];
    weekdays: number[];
    dayOfMonth: number | null;
    spawnTime: string;
    rewardCents: number | null;
  }) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(rule.title);
  const [notes, setNotes] = useState(rule.notes ?? '');
  const [assignee, setAssignee] = useState<number | null>(rule.defaultAssignee);
  const [isAsap, setIsAsap] = useState(rule.isAsap);
  const [repeat, setRepeat] = useState<RepeatState>(toRepeatState(rule));
  const [reward, setReward] = useState(
    rule.rewardCents === null ? '' : String(rule.rewardCents / 100),
  );
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

      <CheckRow
        label="ASAP"
        hint="Every copy lands on the shared ASAP row."
        checked={isAsap}
        onChange={setIsAsap}
      />

      <div style={{ borderTop: '1px solid var(--hairline)' }} />

      <RepeatControls value={repeat} onChange={setRepeat} />

      <p className="type-caption text-[var(--text-tertiary)]">
        Copies already on the board keep what they say now — only the next one changes.
      </p>

      {canSetReward ? (
      <div>
        <span className="type-label block text-[var(--text-tertiary)]">Cash reward</span>
        <div className="mt-2 flex items-center gap-2">
          <span
            className="type-headline px-1"
            style={{ color: reward ? 'var(--accent)' : 'var(--text-tertiary)' }}
          >
            $
          </span>
          <input
            value={reward}
            onChange={(e) => setReward(e.target.value.replace(/[^0-9.]/g, '').slice(0, 7))}
            inputMode="decimal"
            placeholder=""
            aria-label="Cash reward in dollars"
            className="tap-target type-headline w-28 rounded-[var(--radius-control)] px-3.5 py-2"
            style={{ background: 'var(--surface-strong)', border: '1px solid var(--hairline)' }}
          />
        </div>
      </div>
      ) : null}

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
              // A rule keeps the tab it was made on; moving work between tabs
              // is not something an edit here should do behind anyone's back.
              groupId: rule.groupId,
              isAsap,
              pattern: repeat.pattern,
              weekdays: repeat.weekdays,
              dayOfMonth: repeat.pattern === 'monthly' ? repeat.dayOfMonth : null,
              spawnTime: repeat.spawnTime,
              rewardCents: canSetReward ? parseRewardInput(reward) : rule.rewardCents,
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
