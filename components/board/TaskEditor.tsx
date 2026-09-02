'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/Button';
import { CheckRow } from '@/components/ui/CheckRow';
import { Segmented } from '@/components/ui/Segmented';
import { Rail } from '@/components/ui/Rail';
import type { BoardTask, NewTaskInput } from '@/lib/board-types';
import type { PersonSummary } from '@/lib/auth/results';
import { SPRING_SHEET } from '@/lib/motion';
import { toLocalInputValue } from '@/lib/time';
import { parseRewardInput } from '@/components/board/NewTaskForm';

/** Editing a task in place, inside the sheet that was already showing it. */
export function TaskEditor({
  task,
  people,
  viewerId,
  viewerIsAdmin,
  busy,
  onCancel,
  onSave,
}: {
  task: BoardTask;
  people: PersonSummary[];
  viewerId: number;
  viewerIsAdmin: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: NewTaskInput) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? '');
  const [assignedTo, setAssignedTo] = useState<number | null>(task.assignedTo);
  const [isAsap, setIsAsap] = useState(task.isAsap);
  const [reward, setReward] = useState(
    task.rewardCents === null ? '' : String(task.rewardCents / 100),
  );
  const [timing, setTiming] = useState<'whenever' | 'due'>(task.dueAt !== null ? 'due' : 'whenever');
  const [dueLocal, setDueLocal] = useState(
    task.dueAt !== null ? toLocalInputValue(task.dueAt) : toLocalInputValue(Date.now() + 3600_000),
  );

  const reassigning = assignedTo !== task.assignedTo;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor="edit-title" className="type-caption block text-[var(--text-tertiary)]">
          What needs doing
        </label>
        <input
          id="edit-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="tap-target type-body mt-1.5 w-full rounded-[var(--radius-control)] px-3.5"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--hairline)' }}
        />
      </div>

      <div>
        <label htmlFor="edit-notes" className="type-caption block text-[var(--text-tertiary)]">
          Details
        </label>
        <textarea
          id="edit-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="type-body mt-1.5 w-full rounded-[var(--radius-control)] px-3.5 py-2.5"
          style={{
            background: 'var(--surface-strong)',
            border: '1px solid var(--hairline)',
            resize: 'vertical',
          }}
        />
      </div>

      <div>
        <span className="type-caption block text-[var(--text-tertiary)]">Who&apos;s doing it</span>
        <Rail className="mt-1.5 flex gap-2 pb-1" label="Who's doing it">
          <Button
            tone={assignedTo === null ? 'primary' : 'secondary'}
            pill
            aria-pressed={assignedTo === null}
            onPress={() => setAssignedTo(null)}
            className="shrink-0"
            style={assignedTo === null ? undefined : { background: 'var(--surface)' }}
          >
            Anyone
          </Button>
          {people.map((p) => (
            <Button
              key={p.id}
              tone={assignedTo === p.id ? 'primary' : 'secondary'}
              pill
              aria-pressed={assignedTo === p.id}
              onPress={() => setAssignedTo(p.id)}
              className="shrink-0"
              style={assignedTo === p.id ? undefined : { background: 'var(--surface)' }}
            >
              <Avatar name={p.name} userId={p.id} size={22} />
              {p.id === viewerId ? `${p.name} (you)` : p.name}
            </Button>
          ))}
        </Rail>
        <AnimatePresence initial={false}>
          {reassigning ? (
            <motion.p
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={SPRING_SHEET}
              className="type-caption text-[var(--text-tertiary)]"
              style={{ overflow: 'hidden' }}
            >
              {assignedTo === null
                ? 'It goes back up for grabs — first person to claim it owns it.'
                : 'They get a notification and have to accept it, so the board never claims someone took work they have not seen.'}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>

      {/* Bounties are money, and money is an owner-only decision. Everyone
          else sees a fixed bounty; they cannot set or change one. */}
      {viewerIsAdmin ? (
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

      <CheckRow
        label="ASAP"
        hint="Shows on the shared ASAP row for everyone."
        checked={isAsap}
        onChange={setIsAsap}
      />

      {/* An existing task's schedule is edited on its own rule, so the editor
          only offers the two states a one-off can be in. */}
      <div>
        <span className="type-label block pb-2 text-[var(--text-tertiary)]">When</span>
        <Segmented
          label="When it is due"
          value={timing}
          onChange={setTiming}
          options={[
            { value: 'whenever', label: 'Whenever', hint: 'No deadline on it.' },
            { value: 'due', label: 'By a time', hint: 'Overdue turns it red and nudges whoever owns it.' },
          ]}
        />
      </div>

      <AnimatePresence initial={false}>
        {timing === 'due' ? (
          <motion.div
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
              className="tap-target type-body w-full rounded-[var(--radius-control)] px-3.5"
              style={{ background: 'var(--surface-strong)', border: '1px solid var(--hairline)' }}
            />
            <p className="type-caption mt-2 text-[var(--text-tertiary)]">Shop time (Boise).</p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="flex gap-2">
        <Button tone="quiet" size="md" grow disabled={busy} onPress={onCancel}>
          Cancel
        </Button>
        <Button
          tone="primary"
          size="md"
          grow
          disabled={busy || title.trim().length === 0}
          onPress={() =>
            onSave({
              title,
              notes,
              assignedTo,
              isAsap,
              dueLocal: timing === 'due' ? dueLocal : null,
              rewardCents: parseRewardInput(reward),
            })
          }
        >
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
