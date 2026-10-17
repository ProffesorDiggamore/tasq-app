'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { PressableLink } from '@/components/ui/PressableLink';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { BoardRow } from '@/components/board/BoardRow';
import { TaskCard } from '@/components/board/TaskCard';
import { TaskSheet } from '@/components/board/TaskSheet';
import { Toast, type ToastMessage } from '@/components/board/Toast';
import { InstallSheet } from '@/components/pwa/InstallSheet';
import { NotificationPrompt } from '@/components/pwa/NotificationPrompt';
import { myDaySections, type CardAction } from '@/components/board/task-display';
import { SPRING_ENTER } from '@/lib/motion';
import {
  acceptTaskAction,
  cancelTaskAction,
  claimTaskAction,
  completeTaskAction,
  declineTaskAction,
  reopenTaskAction,
  updateTaskAction,
} from '@/app/actions';
import type {
  BoardData,
  BoardTask,
  NewTaskInput,
  TaskActionResult,
} from '@/lib/board-types';
import type { PersonSummary } from '@/lib/auth/results';
import { haptic } from '@/lib/haptics';

/**
 * How often a board left open on the shop wall pulls fresh state. 30s on the
 * shop Mac, where it costs nothing; netlify.toml raises it to 60s, because on
 * the free plan every refresh spends from a monthly allowance.
 */
const POLL_MS = (Number(process.env.NEXT_PUBLIC_TASQ_POLL_SECONDS) || 30) * 1000;

export interface Viewer {
  id: number;
  name: string;
  isAdmin: boolean;
}

export function Board({
  board,
  people,
  viewer,
  serverNow,
  initialTaskId = null,
}: {
  board: BoardData;
  people: PersonSummary[];
  viewer: Viewer;
  serverNow: number;
  /** Set when a notification deep-linked straight to a task. */
  initialTaskId?: number | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busyTaskId, setBusyTaskId] = useState<number | null>(null);
  const [openTaskId, setOpenTaskId] = useState<number | null>(initialTaskId);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  // Starts at the server's clock so the first client render matches the HTML.
  const [now, setNow] = useState(serverNow);
  const toastSeq = useRef(0);

  // A shared board has to notice what other people did. Polling pauses while the
  // tab is hidden and catches up the moment it comes back. The same tick also
  // advances the clock that relative times ("in 20 min") read from — one timer,
  // not two, so the whole board re-renders once per interval, not twice.
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now());
        router.refresh();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    timer = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router]);

  const say = useCallback((text: string, tone: ToastMessage['tone'] = 'info') => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, text, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(id);
  }, [toast]);

  const handle = useCallback(
    (
      taskId: number,
      run: () => Promise<TaskActionResult>,
      successText?: string,
      tone: ToastMessage['tone'] = 'info',
    ) => {
      setBusyTaskId(taskId);
      startTransition(async () => {
        const result = await run();
        setBusyTaskId(null);

        if (result.ok) {
          haptic('commit');
          if (successText) say(successText, tone);
          router.refresh();
          return;
        }

        haptic('error');
        switch (result.reason) {
          case 'claimed':
            say(`${result.by} just grabbed this.`, 'error');
            break;
          case 'gone':
            say('That tasq is no longer on the board.', 'error');
            break;
          default:
            say(result.message, 'error');
        }
        // Whatever happened, the board the person is looking at is out of date.
        router.refresh();
      });
    },
    [router, say],
  );

  const onAction = useCallback(
    (action: CardAction, task: BoardTask) => {
      switch (action) {
        case 'accept':
          handle(task.id, () => acceptTaskAction(task.id));
          break;
        case 'claim':
          handle(task.id, () => claimTaskAction(task.id), `"${task.title}" is yours.`);
          break;
        case 'complete':
          // The one action that deserves a micro-reward: the toast arrives with
          // a checkmark pop (components/board/Toast.tsx).
          handle(task.id, () => completeTaskAction(task.id), 'Marked done.', 'success');
          setOpenTaskId(null);
          break;
        case 'reopen':
          handle(task.id, () => reopenTaskAction(task.id));
          setOpenTaskId(null);
          break;
        case 'decline':
          // The card's Decline opens the sheet, where a reason can be given.
          setOpenTaskId(task.id);
          break;
      }
    },
    [handle],
  );

  const onDecline = useCallback(
    (task: BoardTask, reason: string) => {
      handle(task.id, () => declineTaskAction(task.id, reason), 'Back up for grabs.');
      setOpenTaskId(null);
    },
    [handle],
  );

  const onUpdateTask = useCallback(
    (task: BoardTask, input: NewTaskInput) => {
      handle(task.id, () => updateTaskAction(task.id, input), 'Saved.');
    },
    [handle],
  );

  const onCancelTask = useCallback(
    (task: BoardTask) => {
      handle(task.id, () => cancelTaskAction(task.id), 'Cancelled.');
      setOpenTaskId(null);
    },
    [handle],
  );

  const allTasks = useMemo(
    () => [...board.asap, ...board.mine, ...board.pool, ...board.recurring, ...board.done],
    [board],
  );
  const day = useMemo(() => myDaySections(board), [board]);
  const firstOpenId =
    day.mine[0]?.id ?? day.urgent[0]?.id ?? day.available[0]?.id ?? day.teamToday[0]?.id;
  const openTask = openTaskId === null ? null : (allTasks.find((t) => t.id === openTaskId) ?? null);

  // The sheet is open, so its task disappearing means someone else acted on it.
  useEffect(() => {
    if (openTaskId !== null && openTask === null) setOpenTaskId(null);
  }, [openTaskId, openTask]);

  const cardProps = {
    viewerId: viewer.id,
    now,
    onOpen: setOpenTaskId,
    onAction,
    onToast: say,
  };

  return (
    <>
      <main
        className="mx-auto w-full max-w-5xl pb-32"
        style={{ paddingInline: 'var(--gutter)' }}
      >
        <MyDayHeader
          name={viewer.name}
          mine={day.mine.length}
          urgent={board.asapCount}
          available={day.available.length}
        />

        {/* The source queries overlap by design. My Day gives each open task
            one home so urgency stays visible without making the same card take
            over two or three rails. The walkthrough still spotlights this as
            one idea: what is yours, what is urgent, and what can be claimed. */}
        <div data-tour="rows">
          <BoardRow
            title="For you"
            badge={board.awaitingYou}
            count={day.mine.length}
            emptyMessage="Nothing is waiting on you."
          >
            <AnimatePresence initial={false} mode="popLayout">
              {day.mine.map((task) => (
                <RowCard key={task.id} anchor={task.id === firstOpenId ? 'card' : undefined}>
                  <TaskCard task={task} busy={busyTaskId === task.id} {...cardProps} />
                </RowCard>
              ))}
            </AnimatePresence>
          </BoardRow>

          {day.urgent.length > 0 ? (
            <BoardRow
              title="Urgent on this board"
              accent="asap"
              count={day.urgent.length}
              anchor="row-asap"
            >
              <AnimatePresence initial={false} mode="popLayout">
                {day.urgent.map((task) => (
                  <RowCard key={task.id} anchor={task.id === firstOpenId ? 'card' : undefined}>
                    <TaskCard task={task} busy={busyTaskId === task.id} {...cardProps} />
                  </RowCard>
                ))}
              </AnimatePresence>
            </BoardRow>
          ) : null}

          <BoardRow
            title="Available"
            count={day.available.length}
            emptyMessage="There is nothing open to claim."
            anchor="row-grabs"
          >
            <AnimatePresence initial={false} mode="popLayout">
              {day.available.map((task) => (
                <RowCard key={task.id} anchor={task.id === firstOpenId ? 'card' : undefined}>
                  <TaskCard task={task} busy={busyTaskId === task.id} {...cardProps} />
                </RowCard>
              ))}
            </AnimatePresence>
          </BoardRow>

          {day.teamToday.length > 0 ? (
            <BoardRow title="Team today" count={day.teamToday.length}>
              <AnimatePresence initial={false} mode="popLayout">
                {day.teamToday.map((task) => (
                  <RowCard key={task.id} anchor={task.id === firstOpenId ? 'card' : undefined}>
                    <TaskCard task={task} busy={busyTaskId === task.id} {...cardProps} />
                  </RowCard>
                ))}
              </AnimatePresence>
            </BoardRow>
          ) : null}
        </div>

        {board.done.length > 0 ? (
          <BoardRow
            title="Done today"
            collapsible
            defaultOpen={false}
            count={board.done.length}
            anchor="row-done"
          >
            <AnimatePresence initial={false} mode="popLayout">
              {board.done.map((task) => (
                <RowCard key={task.id}>
                  <TaskCard task={task} muted busy={busyTaskId === task.id} {...cardProps} />
                </RowCard>
              ))}
            </AnimatePresence>
          </BoardRow>
        ) : null}
      </main>

      <Toast message={toast} />
      <InstallSheet />
      <NotificationPrompt />

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
        {/* Anyone on the board can post work now, and it lands on the tab they
            are standing on — a task typed under Group 1 belongs to Group 1. */}
        <PressableLink
          href={board.groupId === null ? '/new' : `/new?g=${board.groupId}`}
          data-tour="new-task"
          className="tap-target type-headline pointer-events-auto flex h-14 items-center gap-2 rounded-[var(--radius-pill)] px-6"
          style={{
            background: 'var(--accent)',
            color: 'var(--accent-ink)',
            boxShadow: 'var(--shadow-sheet)',
          }}
        >
          <PlusIcon />
          New tasq
        </PressableLink>
      </div>

      <AnimatePresence>
        {openTask ? (
          <TaskSheet
            key={openTask.id}
            task={openTask}
            people={people}
            viewerId={viewer.id}
            viewerIsAdmin={viewer.isAdmin}
            busy={busyTaskId === openTask.id}
            now={now}
            onClose={() => setOpenTaskId(null)}
            onAction={onAction}
            onDecline={onDecline}
            onCancel={onCancelTask}
            onUpdate={onUpdateTask}
          />
        ) : null}
      </AnimatePresence>
    </>
  );
}

/** Cards keep the same spring-driven enter/exit and glide when a row reorders. */
function RowCard({
  anchor,
  children,
}: {
  /** `data-tour` anchor for the guided tour (components/tour). */
  anchor?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      layout="position"
      data-tour={anchor}
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={SPRING_ENTER}
      className="shrink-0"
    >
      {children}
    </motion.div>
  );
}

function MyDayHeader({
  name,
  mine,
  urgent,
  available,
}: {
  name: string;
  mine: number;
  urgent: number;
  available: number;
}) {
  const firstName = name.trim().split(/\s+/)[0] || name;
  const clear = mine === 0 && urgent === 0 && available === 0;

  return (
    <section className="pt-4" aria-labelledby="my-day-title">
      <p className="type-label text-[var(--text-tertiary)]">My day</p>
      <div className="mt-1.5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="my-day-title" className="type-display">
            {clear ? `You’re clear, ${firstName}.` : `Here’s today, ${firstName}.`}
          </h2>
          <p className="type-callout mt-1 text-[var(--text-secondary)]">
            {clear
              ? 'Nothing needs your attention on this tab.'
              : 'Your work comes first. Urgent and claimable work stay close without taking over.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Today’s task summary">
          <SummaryPill value={mine} label="for you" />
          {urgent > 0 ? <SummaryPill value={urgent} label="urgent" tone="urgent" /> : null}
          <SummaryPill value={available} label="available" />
        </div>
      </div>
    </section>
  );
}

function SummaryPill({
  value,
  label,
  tone = 'default',
}: {
  value: number;
  label: string;
  tone?: 'default' | 'urgent';
}) {
  return (
    <span
      className="type-caption tabular rounded-[var(--radius-pill)] px-2.5 py-1.5"
      style={{
        background:
          tone === 'urgent'
            ? 'color-mix(in srgb, var(--asap) 16%, transparent)'
            : 'var(--surface)',
        border: `1px solid ${
          tone === 'urgent' ? 'color-mix(in srgb, var(--asap) 32%, transparent)' : 'var(--hairline)'
        }`,
        color: tone === 'urgent' ? 'var(--asap)' : 'var(--text-secondary)',
      }}
    >
      <strong style={{ color: tone === 'urgent' ? 'var(--asap)' : 'var(--text)' }}>{value}</strong>{' '}
      {label}
    </span>
  );
}

function PlusIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 2v14M2 9h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
