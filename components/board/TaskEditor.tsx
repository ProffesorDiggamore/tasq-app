'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/Button';
import { Rail } from '@/components/ui/Rail';
import type { BoardTask, NewTaskInput } from '@/lib/board-types';
import type { PersonSummary } from '@/lib/auth/results';
import { SPRING_SHEET } from '@/lib/motion';
import { toLocalInputValue } from '@/lib/time';

/** Editing a task in place, inside the sheet that was already showing it. */
export function TaskEditor({
  task,
  people,
  viewerId,
  busy,
  onCancel,
  onSave,
}: {
  task: BoardTask;
  people: PersonSummary[];
  viewerId: number;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: NewTaskInput) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? '');
  const [assignedTo, setAssignedTo] = useState<number | null>(task.assignedTo);
  const [isAsap, setIsAsap] = useState(task.isAsap);
  const [hasDue, setHasDue] = useState(task.dueAt !== null);
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

      <SwitchRow
        label="ASAP"
        hint="Shows on the shared ASAP row for everyone."
        checked={isAsap}
        onChange={setIsAsap}
      />

      <SwitchRow
        label="Due by a certain time"
        hint="Overdue tasks turn red and nudge whoever owns them."
        checked={hasDue}
        onChange={setHasDue}
      />

      <AnimatePresence initial={false}>
        {hasDue ? (
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
              dueLocal: hasDue ? dueLocal : null,
            })
          }
        >
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="min-w-0 flex-1">
        <span className="type-body block">{label}</span>
        <span className="type-caption block text-[var(--text-tertiary)]">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="relative shrink-0 rounded-full"
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
    </div>
  );
}
