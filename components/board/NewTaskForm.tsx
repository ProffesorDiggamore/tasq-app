'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/Button';
import { CheckRow } from '@/components/ui/CheckRow';
import { Segmented } from '@/components/ui/Segmented';
import { Rail } from '@/components/ui/Rail';
import { createTaskAction } from '@/app/actions';
import { createRecurrenceAction } from '@/app/recurrence-actions';
import { RepeatControls, type RepeatState } from '@/components/board/RepeatControls';
import type { PersonSummary } from '@/lib/auth/results';
import type { GroupTab } from '@/lib/board-types';
import { haptic } from '@/lib/haptics';
import { SPRING_ENTER, SPRING_SHEET } from '@/lib/motion';
import { localDateString, localClockString } from '@/lib/time';

const TITLE_MAX = 120;

/** Dollars typed by a human ("5", "12.50") to whole cents; junk becomes no bounty. */
export function parseRewardInput(text: string): number | null {
  const parsed = Number.parseFloat(text.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 500) return null;
  return Math.round(parsed * 100);
}

export function NewTaskForm({
  people,
  viewerId,
  canSetReward,
  tabs,
  initialGroupId,
}: {
  people: PersonSummary[];
  viewerId: number;
  /** A bounty is spending, so only an admin is shown the field. */
  canSetReward: boolean;
  /** Group tabs this person may post to. Empty on a board with no groups. */
  tabs: GroupTab[];
  /** The tab they pressed New task from; null is the shared Tasqs tab. */
  initialGroupId: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  /** undefined = "Anyone" (the open pool). */
  const [assignedTo, setAssignedTo] = useState<number | null>(null);
  const [groupId, setGroupId] = useState<number | null>(initialGroupId);
  const [reward, setReward] = useState('');
  const [isAsap, setIsAsap] = useState(false);
  /** One value instead of two booleans that could contradict each other. */
  const [timing, setTiming] = useState<'whenever' | 'due' | 'repeats'>('whenever');
  const [dueLocal, setDueLocal] = useState(defaultDue);
  const [repeat, setRepeat] = useState<RepeatState>({
    pattern: 'weekly',
    weekdays: [1],
    dayOfMonth: 1,
    spawnTime: '06:00',
  });
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length > 0 && !pending;

  function submit() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      // A repeating task creates a rule, not a one-off. The action spawns
      // today's instance straight away if the rule is already due.
      const rewardCents = canSetReward ? parseRewardInput(reward) : null;
      const result = timing === 'repeats'
        ? await createRecurrenceAction({
            title,
            notes,
            defaultAssignee: assignedTo,
            groupId,
            isAsap,
            pattern: repeat.pattern,
            weekdays: repeat.weekdays,
            dayOfMonth: repeat.pattern === 'monthly' ? repeat.dayOfMonth : null,
            spawnTime: repeat.spawnTime,
            rewardCents,
          })
        : await createTaskAction({
            title,
            notes,
            assignedTo,
            groupId,
            isAsap,
            dueLocal: timing === 'due' ? dueLocal : null,
            rewardCents,
          });
      if (result.ok) {
        haptic('commit');
        // Back to the tab it was posted to, not always the shared one.
        router.push(groupId === null ? '/' : `/?g=${groupId}`);
        router.refresh();
        return;
      }
      haptic('error');
      setError('message' in result ? result.message : 'That did not go through.');
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mx-auto w-full max-w-lg pb-32"
      style={{ paddingInline: 'var(--gutter)' }}
    >
      <Field label="What needs doing">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
          placeholder=""
          autoComplete="off"
          autoFocus
          className="tap-target type-body w-full rounded-[var(--radius-control)] px-3.5"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--hairline)' }}
        />
      </Field>

      <Field label="Details" hint="Optional">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder=""
          className="type-body w-full rounded-[var(--radius-control)] px-3.5 py-2.5"
          style={{
            background: 'var(--surface-strong)',
            border: '1px solid var(--hairline)',
            resize: 'vertical',
          }}
        />
      </Field>

      {tabs.length > 0 ? (
        <Field label="Which tab">
          <Rail className="flex gap-2 pb-1" label="Which tab">
            <PersonChip
              selected={groupId === null}
              onSelect={() => setGroupId(null)}
              label="Tasqs"
            />
            {tabs.map((t) => (
              <PersonChip
                key={t.id}
                selected={groupId === t.id}
                onSelect={() => setGroupId(t.id)}
                label={t.name}
              />
            ))}
          </Rail>
          <p className="type-caption mt-2 text-[var(--text-tertiary)]">
            {groupId === null
              ? 'Everyone on the board sees the Tasqs tab.'
              : 'Only people on that tab — and admins — will see it.'}
          </p>
        </Field>
      ) : null}

      <Field label="Who's doing it">
        <Rail className="flex gap-2 pb-1" label="Who's doing it">
          <PersonChip
            selected={assignedTo === null}
            onSelect={() => setAssignedTo(null)}
            label="Anyone"
          />
          {people.map((p) => (
            <PersonChip
              key={p.id}
              selected={assignedTo === p.id}
              onSelect={() => setAssignedTo(p.id)}
              label={p.id === viewerId ? `${p.name} (you)` : p.name}
              avatar={<Avatar name={p.name} userId={p.id} size={24} />}
            />
          ))}
        </Rail>
        <p className="type-caption mt-2 text-[var(--text-tertiary)]">
          {assignedTo === null
            ? 'It goes up for grabs — first person to claim it owns it.'
            : 'They get a notification and can accept or pass it back to the pool.'}
        </p>
      </Field>

      {canSetReward ? (
      <Field label="Cash reward" hint="Optional">
        <div className="flex items-center gap-2">
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
        <p className="type-caption mt-2 text-[var(--text-tertiary)]">
          {reward.length > 0 && parseRewardInput(reward) === null
            ? 'Whole dollars up to $500.'
            : 'Whoever finishes it pockets this. Shows as a green tag on the card.'}
        </p>
      </Field>
      ) : null}

      {/* Timing used to be three switches, two of which contradicted each other
          — a task cannot both repeat on a schedule and be due at one moment, and
          the old form expressed that by silently collapsing a row away. Three
          mutually exclusive states are one question, so they are one control,
          and the impossible combination cannot be typed in the first place. */}
      <Field label="When">
        <Segmented
          label="When it is due"
          value={timing}
          onChange={setTiming}
          options={[
            { value: 'whenever', label: 'Whenever', hint: 'No deadline — it sits on the board until someone does it.' },
            { value: 'due', label: 'By a time', hint: 'Overdue tasks turn red and nudge whoever owns them.' },
            { value: 'repeats', label: 'Repeats', hint: 'Spawns a fresh copy on a schedule, like Monday greasing.' },
          ]}
        />

        <AnimatePresence initial={false} mode="popLayout">
          {timing === 'due' ? (
            <motion.div
              key="due"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={SPRING_SHEET}
              style={{ overflow: 'hidden' }}
            >
              <input
                type="datetime-local"
                value={dueLocal}
                onChange={(e) => setDueLocal(e.target.value)}
                aria-label="Due date and time"
                className="tap-target type-body mt-3 w-full rounded-[var(--radius-control)] px-3.5"
                style={{
                  background: 'var(--surface-strong)',
                  border: '1px solid var(--hairline)',
                }}
              />
              <p className="type-caption mt-2 text-[var(--text-tertiary)]">Shop time (Boise).</p>
            </motion.div>
          ) : null}

          {timing === 'repeats' ? (
            <motion.div
              key="repeat"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={SPRING_SHEET}
              style={{ overflow: 'hidden' }}
            >
              <div className="mt-3">
                <RepeatControls value={repeat} onChange={setRepeat} />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Field>

      <div className="material-card mt-5 rounded-[var(--radius-card)] p-4">
        <CheckRow
          label="ASAP"
          hint="Shows on the shared ASAP row for everyone, whoever it belongs to."
          checked={isAsap}
          onChange={setIsAsap}
        />
      </div>

      <AnimatePresence>
        {error ? (
          <motion.p
            key={error}
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
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
        <Button
          type="submit"
          tone="primary"
          size="lg"
          pill
          disabled={!canSubmit}
          onPress={submit}
          className="type-headline w-full max-w-lg"
          style={{ boxShadow: 'var(--shadow-sheet)' }}
        >
          {pending ? 'Adding…' : timing === 'repeats' ? 'Add repeating task' : 'Add to the board'}
        </Button>
      </div>
    </form>
  );
}

/** Next full hour, in shop time, so the common case needs no typing. */
function defaultDue(): string {
  const inAnHour = Date.now() + 60 * 60 * 1000;
  const hour = localClockString(inAnHour).slice(0, 2);
  return `${localDateString(inAnHour)}T${hour}:00`;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5 first:mt-0">
      <div className="mb-2 flex items-baseline gap-2 px-1">
        <span className="type-label text-[var(--text-tertiary)]">{label}</span>
        {hint ? <span className="type-caption text-[var(--text-tertiary)]">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function PersonChip({
  selected,
  onSelect,
  label,
  avatar,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  avatar?: React.ReactNode;
}) {
  return (
    <Button
      tone={selected ? 'primary' : 'secondary'}
      pill
      aria-pressed={selected}
      onPress={onSelect}
      className="shrink-0"
      style={selected ? undefined : { background: 'var(--surface)' }}
    >
      {avatar}
      {label}
    </Button>
  );
}
