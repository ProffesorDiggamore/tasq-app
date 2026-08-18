'use client';

import { memo } from 'react';
import { motion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import { cardActions, dueDisplay, ownerLine, type CardAction } from '@/components/board/task-display';
import type { BoardTask } from '@/lib/board-types';
import { SPRING_ENTER } from '@/lib/motion';

const ACTION_LABEL: Record<CardAction, string> = {
  accept: 'Accept',
  decline: 'Decline',
  claim: 'Claim',
  complete: 'Done',
  reopen: 'Undo',
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
      className="material-card relative flex shrink-0 snap-start flex-col rounded-[var(--radius-card)] p-3.5"
      style={{
        width: emphasis ? 296 : 264,
        borderColor: emphasis
          ? 'color-mix(in srgb, var(--asap) 40%, transparent)'
          : needsYou
            ? 'color-mix(in srgb, var(--accent) 38%, transparent)'
            : 'var(--hairline)',
        background: emphasis
          ? 'color-mix(in srgb, var(--asap) 9%, var(--surface))'
          : 'var(--surface)',
      }}
    >
      {/* The whole card is the target; the buttons below sit above it. */}
      <button
        type="button"
        onClick={() => onOpen(task.id)}
        className="pressable absolute inset-0 rounded-[var(--radius-card)]"
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
            <CardButton
              key={action}
              action={action}
              disabled={busy}
              onPress={() => onAction(action, task)}
            />
          ))}
        </div>
      ) : (
        <div className="mt-3 h-0" />
      )}
    </motion.article>
  );
}

function CardButton({
  action,
  disabled,
  onPress,
}: {
  action: CardAction;
  disabled: boolean;
  onPress: () => void;
}) {
  const filled = action === 'accept' || action === 'claim' || action === 'complete';
  const quiet = action === 'decline' || action === 'reopen';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPress}
      className="pressable type-callout flex h-11 flex-1 items-center justify-center rounded-[var(--radius-control)] disabled:opacity-45"
      style={{
        background: filled ? 'var(--accent)' : 'var(--surface-strong)',
        color: filled ? 'var(--accent-ink)' : quiet ? 'var(--text-secondary)' : 'var(--text)',
        border: filled ? '1px solid transparent' : '1px solid var(--hairline)',
        fontWeight: 600,
      }}
    >
      {ACTION_LABEL[action]}
    </button>
  );
}

export const TaskCard = memo(TaskCardImpl);
