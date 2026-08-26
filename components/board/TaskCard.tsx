'use client';

import { memo } from 'react';
import { motion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/Button';
import { cardActions, dueDisplay, ownerLine, type CardAction } from '@/components/board/task-display';
import type { BoardTask } from '@/lib/board-types';
import { usePress } from '@/lib/use-press';
import { SPRING_ENTER } from '@/lib/motion';

const ACTION_LABEL: Record<CardAction, string> = {
  accept: 'Accept',
  decline: 'Decline',
  claim: 'Claim',
  complete: 'Done',
  reopen: 'Undo',
};

const ACTION_TONE: Record<CardAction, 'primary' | 'secondary' | 'quiet'> = {
  accept: 'primary',
  claim: 'primary',
  complete: 'primary',
  decline: 'quiet',
  reopen: 'quiet',
};

export interface TaskCardProps {
  task: BoardTask;
  viewerId: number;
  /** ASAP cards are wider and warmer — this row is read first, at 6am. */
  emphasis?: boolean;
  muted?: boolean;
  busy: boolean;
  now: number;
  onOpen: (taskId: number) => void;
  onAction: (action: CardAction, task: BoardTask) => void;
}

function TaskCardImpl({
  task,
  viewerId,
  emphasis = false,
  muted = false,
  busy,
  now,
  onOpen,
  onAction,
}: TaskCardProps) {
  const due = dueDisplay(task, now);
  const actions = cardActions(task, viewerId);
  const needsYou = task.assignedTo === viewerId && task.status === 'pending';
  const { pressed, handlers } = usePress(() => onOpen(task.id));

  const borderColor = emphasis
    ? 'color-mix(in srgb, var(--asap) 40%, transparent)'
    : needsYou
      ? 'color-mix(in srgb, var(--accent) 38%, transparent)'
      : 'var(--hairline)';

  return (
    <motion.article
      // `layout` only — deliberately no layoutId. The same task legitimately
      // appears in more than one row (an ASAP task assigned to you shows in both
      // ASAP and Your Tasks), and a shared layoutId would make Motion treat the
      // two cards as one element and blank whichever it did not pick.
      layout
      transition={SPRING_ENTER}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: muted ? 0.62 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className="relative shrink-0 snap-start"
      style={{ width: emphasis ? 296 : 264 }}
    >
      {/* The press scale lives on this inner surface, not on the article:
          Motion's layout animation owns the article's transform. */}
      <div
        className="material-card press-surface flex h-full flex-col rounded-[var(--radius-card)] p-3.5"
        data-pressed={pressed ? '' : undefined}
        style={{
          borderColor,
          background: emphasis
            ? 'color-mix(in srgb, var(--asap) 9%, var(--surface))'
            : 'var(--surface)',
        }}
      >
        {/* The whole card opens the sheet; the action buttons sit above it. */}
        <button
          type="button"
          {...handlers}
          className="absolute inset-0 rounded-[var(--radius-card)]"
          aria-label={`Open ${task.title}`}
        />

        <div className="pointer-events-none relative flex items-center gap-2">
          {task.isAsap ? (
            <span
              className="type-label rounded-[var(--radius-pill)] px-2 py-1"
              style={{ background: 'var(--asap)', color: 'var(--asap-ink)' }}
            >
              ASAP
            </span>
          ) : null}
          {task.isRecurring ? (
            <span className="type-caption text-[var(--text-tertiary)]">Repeating</span>
          ) : null}
          {task.rewardCents !== null ? (
            <motion.span
              key={task.rewardCents}
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={SPRING_ENTER}
              className="type-label rounded-[var(--radius-pill)] px-2 py-0.5"
              style={{ background: 'color-mix(in srgb, var(--success) 22%, transparent)', color: 'var(--success)' }}
              aria-label={`Pays $${(task.rewardCents / 100).toFixed(task.rewardCents % 100 === 0 ? 0 : 2)}`}
            >
              ${(task.rewardCents / 100).toFixed(task.rewardCents % 100 === 0 ? 0 : 2)}
            </motion.span>
          ) : null}
          {due ? (
            <span
              className="type-caption tabular ml-auto"
              style={{ color: due.overdue ? 'var(--danger)' : 'var(--text-tertiary)' }}
            >
              {due.overdue ? 'Overdue · ' : ''}
              {due.label}
            </span>
          ) : null}
        </div>

        <h3
          className="type-headline pointer-events-none relative mt-2"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            textDecoration: task.status === 'done' ? 'line-through' : undefined,
            textDecorationColor: 'var(--text-tertiary)',
          }}
        >
          {task.title}
        </h3>

        <div className="pointer-events-none relative mt-2 flex items-center gap-2">
          {task.assignedTo !== null ? (
            <Avatar name={task.assignedToName ?? '?'} userId={task.assignedTo} size={22} />
          ) : null}
          <span className="type-caption truncate text-[var(--text-secondary)]">
            {ownerLine(task, viewerId)}
          </span>
        </div>

        {actions.length > 0 ? (
          <div className="relative mt-3 flex gap-2">
            {actions.map((action) => (
              <Button
                key={action}
                tone={ACTION_TONE[action]}
                grow
                disabled={busy}
                onPress={() => onAction(action, task)}
              >
                {ACTION_LABEL[action]}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </motion.article>
  );
}

export const TaskCard = memo(TaskCardImpl);
