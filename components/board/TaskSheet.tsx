'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/Button';
import { TaskEditor } from '@/components/board/TaskEditor';
import { useSheetDrag } from '@/components/board/useSheetDrag';
import { cardActions, dueDisplay, type CardAction } from '@/components/board/task-display';
import type { BoardTask, NewTaskInput } from '@/lib/board-types';
import type { PersonSummary } from '@/lib/auth/results';
import { formatFull } from '@/lib/time';
import { SPRING_ENTER } from '@/lib/motion';

export interface TaskSheetProps {
  task: BoardTask;
  people: PersonSummary[];
  viewerId: number;
  viewerIsAdmin: boolean;
  busy: boolean;
  now: number;
  onClose: () => void;
  onAction: (action: CardAction, task: BoardTask) => void;
  onDecline: (task: BoardTask, reason: string) => void;
  onCancel: (task: BoardTask) => void;
  onUpdate: (task: BoardTask, input: NewTaskInput) => void;
}

const ACTION_LABEL: Record<CardAction, string> = {
  accept: 'Accept',
  decline: 'Decline',
  claim: 'Claim this',
  complete: 'Mark done',
  reopen: 'Put it back',
};

export function TaskSheet({
  task,
  people,
  viewerId,
  viewerIsAdmin,
  busy,
  now,
  onClose,
  onAction,
  onDecline,
  onCancel,
  onUpdate,
}: TaskSheetProps) {
  const { y, scrimOpacity, sheetRef, handleProps, dismiss } = useSheetDrag(onClose);
  const [decliningOpen, setDecliningOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const due = dueDisplay(task, now);
  const actions = cardActions(task, viewerId);
  const isOpen = task.status === 'pending' || task.status === 'accepted';
  // Same bar as cancelling: retitling someone's work is the same kind of act.
  const canEdit = (task.createdBy === viewerId || viewerIsAdmin) && isOpen;
  const canCancel = canEdit;

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <motion.div
        // Dim to focus: this is a modal task, so the board goes back and down.
        className="absolute inset-0"
        style={{ background: 'var(--scrim)', opacity: scrimOpacity }}
        onClick={() => dismiss()}
        aria-hidden="true"
      />

      <motion.div
        ref={(node) => {
          sheetRef.current = node;
          panelRef.current = node;
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-sheet-title"
        tabIndex={-1}
        className="material-sheet relative w-full max-w-lg outline-none"
        style={{
          y,
          borderRadius: 'var(--radius-sheet) var(--radius-sheet) 0 0',
          maxHeight: '88dvh',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* The grab area is the header only, so the body below can still scroll. */}
        <div {...handleProps} className="cursor-grab px-5 pb-3 pt-2.5 active:cursor-grabbing">
          <div
            className="mx-auto h-1 w-9 rounded-full"
            style={{ background: 'var(--text-tertiary)' }}
            aria-hidden="true"
          />

          <div className="mt-3.5 flex items-start gap-2">
            {task.isAsap ? (
              <span
                className="type-label mt-1 rounded-[var(--radius-pill)] px-2 py-1"
                style={{ background: 'var(--asap)', color: 'var(--asap-ink)' }}
              >
                ASAP
              </span>
            ) : null}
            <h2 id="task-sheet-title" className="type-title flex-1">
              {task.title}
            </h2>
          </div>
        </div>

        <div className="max-h-[58dvh] overflow-y-auto px-5 pb-5">
          {task.notes ? (
            <p className="type-body whitespace-pre-wrap text-[var(--text-secondary)]">
              {task.notes}
            </p>
          ) : null}


          <dl className="mt-4 flex flex-col gap-2.5">
            <Detail label="Status">
              <StatusPill task={task} viewerId={viewerId} />
            </Detail>

            <Detail label={task.assignedTo === null ? 'Open to' : 'Assigned to'}>
              {task.assignedTo === null ? (
                <span className="type-callout">Anyone</span>
              ) : (
                <span className="flex items-center gap-2">
                  <Avatar name={task.assignedToName ?? '?'} userId={task.assignedTo} size={22} />
                  <span className="type-callout">
                    {task.assignedTo === viewerId ? 'You' : task.assignedToName}
                  </span>
                </span>
              )}
            </Detail>

            <Detail label="Added by">
              <span className="flex items-center gap-2">
                <Avatar name={task.createdByName} userId={task.createdBy} size={22} />
                <span className="type-callout">
                  {task.createdBy === viewerId ? 'You' : task.createdByName}
                </span>
              </span>
            </Detail>

            {due ? (
              <Detail label="Due">
                <span
                  className="type-callout tabular"
                  style={{ color: due.overdue ? 'var(--danger)' : undefined }}
                >
                  {formatFull(task.dueAt!)}
                  {due.overdue ? ' · overdue' : ''}
                </span>
              </Detail>
            ) : null}

            {task.completedAt ? (
              <Detail label="Finished">
                <span className="type-callout">
                  {task.completedByName ?? 'Someone'} · {formatFull(task.completedAt)}
                </span>
              </Detail>
            ) : null}

            {task.declineReason ? (
              <Detail label="Passed on because">
                <span className="type-callout">{task.declineReason}</span>
              </Detail>
            ) : null}

            <Detail label="Added">
              <span className="type-callout">{formatFull(task.createdAt)}</span>
            </Detail>
          </dl>

          {/* The body's three states (view / edit / decline) cross-fade instead
              of hard-swapping. Exit is a fast 120ms fade so the old form gets
              out of the way; the new one settles up 8px on the enter spring.
              mode="wait" keeps the two from stacking vertically mid-swap. */}
          <AnimatePresence mode="wait" initial={false}>
          {editing ? (
            <motion.div
              key="edit"
              className="mt-5"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={SPRING_ENTER}
            >
              <TaskEditor
                task={task}
                people={people}
                viewerId={viewerId}
                viewerIsAdmin={viewerIsAdmin}
                busy={busy}
                onCancel={() => setEditing(false)}
                onSave={(input) => {
                  setEditing(false);
                  onUpdate(task, input);
                }}
              />
            </motion.div>
          ) : decliningOpen ? (
            <motion.div
              key="decline"
              className="mt-5"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={SPRING_ENTER}
            >
              <label htmlFor="decline-reason" className="type-callout block text-[var(--text-secondary)]">
                Why are you passing? Optional — it goes back up for grabs either way.
              </label>
              <input
                id="decline-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder=""
                autoComplete="off"
                className="tap-target type-body mt-2 w-full rounded-[var(--radius-control)] px-3.5"
                style={{ background: 'var(--surface-strong)', border: '1px solid var(--hairline)' }}
              />
              <div className="mt-3 flex gap-2">
                <Button tone="quiet" size="md" grow disabled={busy} onPress={() => setDecliningOpen(false)}>
                  Keep it
                </Button>
                <Button tone="danger" size="md" grow disabled={busy} onPress={() => onDecline(task, reason)}>
                  Decline
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="actions"
              className="mt-5 flex flex-col gap-2"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={SPRING_ENTER}
            >
              {actions.map((action) => (
                <Button
                  key={action}
                  tone={action === 'decline' ? 'danger' : action === 'reopen' ? 'quiet' : 'primary'}
                  size="md"
                  fullWidth
                  disabled={busy}
                  onPress={() =>
                    action === 'decline' ? setDecliningOpen(true) : onAction(action, task)
                  }
                >
                  {ACTION_LABEL[action]}
                </Button>
              ))}

              {canEdit ? (
                <Button tone="secondary" size="md" fullWidth disabled={busy} onPress={() => setEditing(true)}>
                  Edit this task
                </Button>
              ) : null}

              {canCancel ? (
                <Button
                  tone="quiet"
                  size="md"
                  fullWidth
                  disabled={busy}
                  onPress={() => {
                    if (confirmCancel) onCancel(task);
                    else setConfirmCancel(true);
                  }}
                >
                  {confirmCancel ? 'Tap again to cancel this task' : 'Cancel this task'}
                </Button>
              ) : null}
            </motion.div>
          )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <dt className="type-caption w-28 shrink-0 text-[var(--text-tertiary)]">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

function StatusPill({ task, viewerId }: { task: BoardTask; viewerId: number }) {
  const map: Record<string, { label: string; color: string }> = {
    pending:
      task.assignedTo === null
        ? { label: 'Up for grabs', color: 'var(--accent)' }
        : {
            label: task.assignedTo === viewerId ? 'Waiting on you' : 'Waiting to be accepted',
            color: 'var(--accent)',
          },
    accepted: { label: 'In progress', color: 'var(--accent)' },
    done: { label: 'Done', color: 'var(--success)' },
    declined: { label: 'Declined', color: 'var(--danger)' },
    cancelled: { label: 'Cancelled', color: 'var(--text-tertiary)' },
  };
  const { label, color } = map[task.status];
  return (
    <span
      className="type-caption rounded-[var(--radius-pill)] px-2.5 py-1"
      style={{
        background: `color-mix(in srgb, ${color} 18%, transparent)`,
        color,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

