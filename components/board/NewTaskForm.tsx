'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import { createTaskAction } from '@/app/actions';
import type { PersonSummary } from '@/lib/auth/results';
import { haptic } from '@/lib/haptics';
import { SPRING_ENTER, SPRING_SHEET } from '@/lib/motion';
import { localDateString, localClockString } from '@/lib/time';

const TITLE_MAX = 120;

export function NewTaskForm({ people, viewerId }: { people: PersonSummary[]; viewerId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  /** undefined = "Anyone" (the open pool). */
  const [assignedTo, setAssignedTo] = useState<number | null>(null);
  const [isAsap, setIsAsap] = useState(false);
  const [hasDue, setHasDue] = useState(false);
  const [dueLocal, setDueLocal] = useState(defaultDue);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length > 0 && !pending;

  function submit() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const result = await createTaskAction({
        title,
        notes,
        assignedTo,
        isAsap,
        dueLocal: hasDue ? dueLocal : null,
      });
      if (result.ok) {
        haptic('commit');
        router.push('/');
        router.refresh();
        return;
      }
      haptic('error');
      setError(result.reason === 'gone' ? 'That task is no longer there.' : messageOf(result));
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
          placeholder="Grease the skid steer"
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
          placeholder="Zerks on the loader arms too. Grease gun is on the blue cart."
          className="type-body w-full rounded-[var(--radius-control)] px-3.5 py-2.5"
          style={{
            background: 'var(--surface-strong)',
            border: '1px solid var(--hairline)',
            resize: 'vertical',
          }}
        />
      </Field>

      <Field label="Who's doing it">
        <div className="rail flex gap-2 pb-1">
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
        </div>
        <p className="type-caption mt-2 text-[var(--text-tertiary)]">
          {assignedTo === null
            ? 'It goes up for grabs — first person to claim it owns it.'
            : 'They get a notification and can accept or pass it back to the pool.'}
        </p>
      </Field>

      <div className="material-card mt-5 flex flex-col gap-3.5 rounded-[var(--radius-card)] p-4">
        <SwitchRow
          label="ASAP"
          hint="Shows on the shared ASAP row for everyone."
          checked={isAsap}
          onChange={setIsAsap}
        />

        <div style={{ borderTop: '1px solid var(--hairline)' }} />

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
        <button
          type="submit"
          disabled={!canSubmit}
          className="pressable type-headline flex h-14 w-full max-w-lg items-center justify-center rounded-[var(--radius-pill)] disabled:opacity-40"
          style={{
            background: 'var(--accent)',
            color: 'var(--accent-ink)',
            boxShadow: 'var(--shadow-sheet)',
          }}
        >
          {pending ? 'Adding…' : 'Add to the board'}
        </button>
      </div>
    </form>
  );
}

function messageOf(result: { reason: string; message?: string }): string {
  return result.message ?? 'That did not go through.';
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
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="pressable tap-target flex shrink-0 items-center gap-2 rounded-[var(--radius-pill)] px-3.5"
      style={{
        background: selected ? 'var(--accent)' : 'var(--surface)',
        color: selected ? 'var(--accent-ink)' : 'var(--text)',
        border: `1px solid ${selected ? 'transparent' : 'var(--hairline)'}`,
        fontWeight: selected ? 600 : 400,
        fontSize: '0.9375rem',
      }}
    >
      {avatar}
      {label}
    </button>
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
