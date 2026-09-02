'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BoardTask } from '@/lib/board-types';
import { haptic } from '@/lib/haptics';
import { usePress } from '@/lib/use-press';
import {
  PHOTO_MAX_BYTES,
  PhotoTooLargeError,
  photoUrl,
  preparePhoto,
} from '@/lib/photo-client';

/**
 * The whole photo-proof feature in one quiet control, sitting at the end of a
 * card's action row:
 *  - no photo yet: a small camera button. Tap → the OS camera/file picker
 *    (a plain <input type="file">, no custom camera UI).
 *  - photo present: the board thumbnail, lazy-loaded. Tap → a plain viewer
 *    with the full photo and a two-tap Remove.
 * Everything is optional; a task with no photo costs one 44px ghost circle.
 */
export function PhotoButton({
  task,
  onToast,
}: {
  task: BoardTask;
  onToast: (text: string, tone?: 'info' | 'error') => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const pick = () => {
    haptic('tap');
    inputRef.current?.click();
  };
  const { pressed, handlers } = usePress(task.hasPhoto ? () => setViewing(true) : pick);

  const onPick = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const { full, thumb } = await preparePhoto(file);
      // Multipart, not a header: a detailed 320px thumb is 30-70KB as base64,
      // past Node's ~16KB header cap — the server would 431 the whole request.
      const form = new FormData();
      form.append('full', full, 'full.jpg');
      form.append('thumb', thumb, 'thumb.jpg');
      const res = await fetch(`/api/tasks/${task.id}/photo`, {
        method: 'POST',
        body: form,
      });
      if (res.ok) {
        haptic('commit');
        onToast('Photo saved.');
        router.refresh();
      } else {
        const code = (await res.json().catch(() => null))?.code as string | undefined;
        haptic('error');
        onToast(
          code === 'TASQ-E0701'
            ? 'That photo is still too big after shrinking — try again.'
            : 'Could not save the photo. Try again.',
          'error',
        );
      }
    } catch (err) {
      haptic('error');
      onToast(
        err instanceof PhotoTooLargeError
          ? `That photo would not shrink under ${(PHOTO_MAX_BYTES / (1024 * 1024)).toFixed(0)}MB — try a different one.`
          : 'Could not read that photo. Try again.',
        'error',
      );
    } finally {
      setBusy(false);
      // Let the same file be picked twice in a row.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <button
        type="button"
        {...handlers}
        disabled={busy}
        aria-label={
          task.hasPhoto ? `View photo for ${task.title}` : `Add photo to ${task.title}`
        }
        className="tap-target relative flex h-11 w-11 shrink-0 items-center justify-center self-center rounded-full"
        style={{
          background: 'var(--surface-strong)',
          border: '1px solid var(--hairline)',
          overflow: 'hidden',
        }}
      >
        {task.hasPhoto && task.photoUpdatedAt !== null ? (
          <img
            src={photoUrl(task.id, task.photoUpdatedAt, 'thumb')}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            style={{ opacity: busy ? 0.5 : 1 }}
          />
        ) : (
          <span
            className="press-scale flex items-center justify-center"
            data-pressed={pressed ? '' : undefined}
          >
            <CameraIcon />
          </span>
        )}
        {busy ? (
          <span
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: 'color-mix(in srgb, var(--surface) 55%, transparent)' }}
            aria-hidden="true"
          >
            <span className="type-caption" style={{ color: 'var(--text-secondary)' }}>
              …
            </span>
          </span>
        ) : null}
      </button>

      {/* The plain OS picker — no custom camera UI, exactly as designed. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />

      {viewing ? (
        <PhotoViewer
          task={task}
          busy={busy}
          confirmRemove={confirmRemove}
          onConfirmRemove={setConfirmRemove}
          onClose={() => {
            setViewing(false);
            setConfirmRemove(false);
          }}
          onRemove={async () => {
            if (!confirmRemove) {
              setConfirmRemove(true);
              return;
            }
            setBusy(true);
            let ok = false;
            try {
              // A dead network must not leave the viewer spinner-locked or the
              // rejection unhandled — this runs from an event handler.
              ok = (await fetch(`/api/tasks/${task.id}/photo`, { method: 'DELETE' })).ok;
            } catch {
              ok = false;
            }
            setBusy(false);
            if (ok) {
              haptic('commit');
              onToast('Photo removed.');
            } else {
              haptic('error');
              onToast('Could not remove the photo. Try again.', 'error');
            }
            setViewing(false);
            setConfirmRemove(false);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function PhotoViewer({
  task,
  busy,
  confirmRemove,
  onConfirmRemove,
  onClose,
  onRemove,
}: {
  task: BoardTask;
  busy: boolean;
  confirmRemove: boolean;
  onConfirmRemove: (value: boolean) => void;
  onClose: () => void;
  onRemove: () => void;
}) {
  // The full photo only leaves the database when someone actually asks for it.
  // The object URL is revoked the moment the viewer closes.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    void (async () => {
      const res = await fetch(photoUrl(task.id, task.photoUpdatedAt ?? 0, 'full'));
      if (!res.ok || cancelled) return;
      const blob = await res.blob();
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [task.id, task.photoUpdatedAt]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Photo for ${task.title}`}
    >
      <div
        className="absolute inset-0"
        style={{ background: 'var(--scrim)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative flex max-h-[70dvh] items-center justify-center">
        {url ? (
          <img
            src={url}
            alt={`Photo proof for ${task.title}`}
            className="max-h-[70dvh] max-w-full rounded-[var(--radius-card)] object-contain"
            style={{ boxShadow: 'var(--shadow-sheet)' }}
          />
        ) : (
          <span className="type-body" style={{ color: 'var(--text-secondary)' }}>
            Loading…
          </span>
        )}
      </div>
      <div className="relative flex gap-2">
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="tap-target type-callout flex h-12 items-center rounded-[var(--radius-control)] px-5 disabled:opacity-45"
          style={{
            background: 'color-mix(in srgb, var(--danger) 16%, transparent)',
            color: 'var(--danger)',
            border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
            fontWeight: 500,
          }}
        >
          {confirmRemove ? 'Tap again to remove' : 'Remove photo'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="tap-target type-callout flex h-12 items-center rounded-[var(--radius-control)] px-5"
          style={{
            background: 'var(--surface-strong)',
            color: 'var(--text)',
            border: '1px solid var(--hairline)',
            fontWeight: 500,
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

function CameraIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M7.2 4.5 6.1 6.2H4.2A2.2 2.2 0 0 0 2 8.4v6A2.2 2.2 0 0 0 4.2 16.6h11.6a2.2 2.2 0 0 0 2.2-2.2v-6a2.2 2.2 0 0 0-2.2-2.2h-1.9l-1.1-1.7a1.4 1.4 0 0 0-1.2-.7H8.4a1.4 1.4 0 0 0-1.2.7Z"
        stroke="var(--text-tertiary)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="11.2" r="2.7" stroke="var(--text-tertiary)" strokeWidth="1.5" />
    </svg>
  );
}
