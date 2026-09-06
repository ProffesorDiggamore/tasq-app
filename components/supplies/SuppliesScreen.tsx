'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/Button';
import { Toast, type ToastMessage } from '@/components/board/Toast';
import {
  advanceSupplyRequestAction,
  createSupplyRequestAction,
} from '@/app/supply-actions';
import type { SupplyQueue, SupplyRow } from '@/lib/board-types';
import type { ActionResult } from '@/lib/action-result';
import { haptic } from '@/lib/haptics';
import { SPRING_ENTER, SPRING_SHEET } from '@/lib/motion';
import { formatFull, relativeTime } from '@/lib/time';

export function SuppliesScreen({
  queue,
  mine,
  isAdmin,
  viewerId,
  serverNow,
}: {
  /** Only populated for admins — everyone else sees `mine`. */
  queue: SupplyQueue | null;
  mine: SupplyRow[];
  isAdmin: boolean;
  viewerId: number;
  serverNow: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [item, setItem] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busy, setBusy] = useState<number | 'new' | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [now, setNow] = useState(serverNow);
  const seq = useRef(0);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(id);
  }, [toast]);

  const say = useCallback((text: string, tone: ToastMessage['tone'] = 'info') => {
    seq.current += 1;
    setToast({ id: seq.current, text, tone });
  }, []);

  const run = useCallback(
    (key: number | 'new', fn: () => Promise<ActionResult>, success?: string) => {
      setBusy(key);
      startTransition(async () => {
        const result = await fn();
        setBusy(null);
        if (result.ok) {
          haptic('commit');
          if (success) say(success);
          router.refresh();
        } else {
          haptic('error');
          say(result.message, 'error');
        }
      });
    },
    [router, say],
  );

  const submit = () => {
    if (item.trim().length === 0) return;
    run(
      'new',
      async () => {
        const result = await createSupplyRequestAction({ item, quantity, notes });
        if (result.ok) {
          setItem('');
          setQuantity('');
          setNotes('');
          setDetailsOpen(false);
        }
        return result;
      },
      'Added to the list.',
    );
  };

  return (
    <>
      <main className="mx-auto w-full max-w-2xl pb-28" style={{ paddingInline: 'var(--gutter)' }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="material-card rounded-[var(--radius-card)] p-4"
        >
          <h2 className="type-headline">Need something?</h2>
          <div className="mt-3 flex flex-col gap-3">
            <input
              value={item}
              onChange={(e) => setItem(e.target.value)}
              placeholder="Blue roll"
              aria-label="What do you need"
              autoComplete="off"
              className="tap-target type-body w-full rounded-[var(--radius-control)] px-3.5"
              style={{ background: 'var(--surface-strong)', border: '1px solid var(--hairline)' }}
            />
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="A case"
              aria-label="How much"
              autoComplete="off"
              className="tap-target type-body w-full rounded-[var(--radius-control)] px-3.5"
              style={{ background: 'var(--surface-strong)', border: '1px solid var(--hairline)' }}
            />

            {/* The third field is tucked away — most requests are two words. */}
            <AnimatePresence initial={false}>
              {detailsOpen ? (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={SPRING_SHEET}
                  style={{ overflow: 'hidden' }}
                >
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="Anything else worth knowing"
                    aria-label="Anything else"
                    className="type-body w-full rounded-[var(--radius-control)] px-3.5 py-2.5"
                    style={{
                      background: 'var(--surface-strong)',
                      border: '1px solid var(--hairline)',
                      resize: 'vertical',
                    }}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="flex gap-2">
              {detailsOpen ? null : (
                <Button tone="quiet" onPress={() => setDetailsOpen(true)}>
                  Add a note
                </Button>
              )}
              <Button
                type="submit"
                tone="primary"
                grow
                disabled={item.trim().length === 0 || busy === 'new'}
                onPress={submit}
              >
                {busy === 'new' ? 'Adding…' : 'Ask for it'}
              </Button>
            </div>
          </div>
        </form>

        {isAdmin && queue ? (
          <AdminQueue queue={queue} busy={busy} now={now} onAdvance={run} />
        ) : (
          <MyRequests rows={mine} now={now} />
        )}
      </main>
      <Toast message={toast} />
    </>
  );
}

function AdminQueue({
  queue,
  busy,
  now,
  onAdvance,
}: {
  queue: SupplyQueue;
  busy: number | 'new' | null;
  now: number;
  onAdvance: (key: number, fn: () => Promise<ActionResult>, success?: string) => void;
}) {
  const total = queue.requested.length + queue.ordered.length + queue.received.length;
  if (total === 0) {
    return <Empty>Nobody needs anything right now.</Empty>;
  }
  return (
    <>
      <Group title="To order" count={queue.requested.length} tone="accent">
        {queue.requested.map((row) => (
          <RequestRow
            key={row.id}
            row={row}
            now={now}
            busy={busy === row.id}
            primary={{
              label: 'Ordered',
              run: () => onAdvance(row.id, () => advanceSupplyRequestAction(row.id, 'ordered'), `${row.item} marked ordered.`),
            }}
          />
        ))}
      </Group>

      <Group title="On order" count={queue.ordered.length} tone="muted">
        {queue.ordered.map((row) => (
          <RequestRow
            key={row.id}
            row={row}
            now={now}
            busy={busy === row.id}
            primary={{
              label: 'Arrived',
              run: () => onAdvance(row.id, () => advanceSupplyRequestAction(row.id, 'received'), `${row.item} marked received.`),
            }}
            secondary={{
              label: 'Undo',
              run: () => onAdvance(row.id, () => advanceSupplyRequestAction(row.id, 'requested')),
            }}
          />
        ))}
      </Group>

      <Group title="Received" count={queue.received.length} tone="muted" collapsible>
        {queue.received.map((row) => (
          <RequestRow
            key={row.id}
            row={row}
            now={now}
            busy={busy === row.id}
            secondary={{
              label: 'Undo',
              run: () => onAdvance(row.id, () => advanceSupplyRequestAction(row.id, 'ordered')),
            }}
          />
        ))}
      </Group>
    </>
  );
}

function MyRequests({ rows, now }: { rows: SupplyRow[]; now: number }) {
  if (rows.length === 0) return <Empty>You haven&apos;t asked for anything yet.</Empty>;
  return (
    <Group title="Yours" count={rows.length} tone="muted">
      {rows.map((row) => (
        <RequestRow key={row.id} row={row} now={now} busy={false} showStatus />
      ))}
    </Group>
  );
}

function Group({
  title,
  count,
  tone,
  collapsible = false,
  children,
}: {
  title: string;
  count: number;
  tone: 'accent' | 'muted';
  collapsible?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!collapsible);
  if (count === 0) return null;
  return (
    <section className="mt-7">
      <div className="flex items-center gap-2 px-1">
        <h2
          className="type-label"
          style={{ color: tone === 'accent' ? 'var(--accent)' : 'var(--text-tertiary)' }}
        >
          {title}
        </h2>
        <span className="type-caption tabular text-[var(--text-tertiary)]">{count}</span>
        {collapsible ? (
          <Button tone="plain" onPress={() => setOpen((o) => !o)} className="ml-auto px-2">
            <span className="type-caption text-[var(--text-secondary)]">
              {open ? 'Hide' : 'Show'}
            </span>
          </Button>
        ) : null}
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.ul
            initial={collapsible ? { height: 0, opacity: 0 } : false}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING_SHEET}
            style={{ overflow: collapsible ? 'hidden' : undefined }}
            className="mt-2 flex flex-col gap-2"
          >
            {children}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

const STATUS_LABEL: Record<SupplyRow['status'], string> = {
  requested: 'Waiting to be ordered',
  ordered: 'On order',
  received: 'Arrived',
};

function RequestRow({
  row,
  now,
  busy,
  primary,
  secondary,
  showStatus = false,
}: {
  row: SupplyRow;
  now: number;
  busy: boolean;
  primary?: { label: string; run: () => void };
  secondary?: { label: string; run: () => void };
  showStatus?: boolean;
}) {
  return (
    <motion.li
      layout
      // `initial={false}` so rows that are already there render at rest; only
      // a row that moves between groups animates.
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={SPRING_ENTER}
      // Wraps on purpose. A row with two buttons (On order: Undo + Arrived)
      // leaves the text column ~110pt on a 375px phone, which truncated the
      // meta line mid-word — "Shelly · 6 days ..." with the "ago" eaten. Below
      // the basis the buttons drop to their own line instead of squeezing it.
      className="material-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-card)] px-4 py-3"
    >
      <Avatar name={row.requestedByName} userId={row.requestedBy} size={32} />
      <div className="min-w-0 flex-1 basis-44">
        {/* The scannable line Chris reads: item — requester. Wraps rather than
            truncating: with two buttons alongside, truncation eats the noun. */}
        <p className="type-headline">
          {row.item}
          {row.quantity ? (
            <span className="type-callout text-[var(--text-secondary)]"> · {row.quantity}</span>
          ) : null}
        </p>
        <p className="type-caption truncate text-[var(--text-tertiary)]">
          {row.requestedByName} · {relativeTime(row.createdAt, now)}
          {showStatus ? ` · ${STATUS_LABEL[row.status]}` : ''}
        </p>
        {row.notes ? (
          <p className="type-caption mt-1 text-[var(--text-secondary)]">{row.notes}</p>
        ) : null}
        {row.receivedAt ? (
          <p className="type-caption mt-1 text-[var(--text-tertiary)]">
            Arrived {formatFull(row.receivedAt)}
          </p>
        ) : null}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {secondary ? (
          <Button tone="quiet" disabled={busy} onPress={secondary.run}>
            {secondary.label}
          </Button>
        ) : null}
        {primary ? (
          <Button tone="primary" disabled={busy} onPress={primary.run}>
            {primary.label}
          </Button>
        ) : null}
      </div>
    </motion.li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="type-callout mt-7 px-1 text-[var(--text-tertiary)]">{children}</p>;
}
