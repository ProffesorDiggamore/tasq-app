'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { animate, useMotionValue, useTransform, type MotionValue } from 'motion/react';
import { prefersReducedMotion, project, rubberband, SPRING_SHEET } from '@/lib/motion';

/** How far the sheet's *projected* landing point must be before it dismisses. */
const MAX_DISMISS_THRESHOLD = 140;
const DISMISS_FRACTION = 0.3;
/** Velocity is averaged over the last frames rather than the last event alone. */
const VELOCITY_WINDOW_MS = 40;

export interface SheetDrag {
  y: MotionValue<number>;
  scrimOpacity: MotionValue<number>;
  sheetRef: React.RefObject<HTMLDivElement | null>;
  /** Spread onto the sheet's grab area — the header, not the scrolling body. */
  handleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
    style: React.CSSProperties;
  };
  /** Animate out along the same path it came in, then unmount. */
  dismiss: (velocity?: number) => void;
}

/**
 * Drag-to-dismiss with 1:1 tracking, rubber-banding above the resting position,
 * momentum projection at release, and velocity handed off to the settling
 * spring so there is no seam between the finger and the animation. Grabbing a
 * sheet mid-flight starts from its live on-screen value, so it can be caught
 * and thrown back at any point.
 */
export function useSheetDrag(onClosed: () => void): SheetDrag {
  // Parked well off-screen for the single frame before the height is measured.
  const y = useMotionValue(2000);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const height = useRef(600);
  const grab = useRef<{ pointerY: number; startY: number } | null>(null);
  const history = useRef<Array<{ y: number; t: number }>>([]);
  const closing = useRef(false);

  const settle = useCallback(
    (target: number, velocity: number) =>
      animate(
        y,
        target,
        prefersReducedMotion()
          ? { duration: 0.16, ease: 'easeOut' }
          : { ...SPRING_SHEET, velocity },
      ),
    [y],
  );

  useLayoutEffect(() => {
    const measured = sheetRef.current?.offsetHeight;
    if (measured && measured > 0) height.current = measured;
    y.set(height.current);
    // Entry carries no gesture momentum, so it gets no bounce of its own.
    animate(y, 0, prefersReducedMotion() ? { duration: 0.16 } : { ...SPRING_SHEET, velocity: 0 });
  }, [y]);

  const dismiss = useCallback(
    (velocity = 0) => {
      if (closing.current) return;
      closing.current = true;
      const animation = settle(height.current, velocity);
      animation.finished.then(onClosed).catch(() => onClosed());
    },
    [settle, onClosed],
  );

  const releaseVelocity = useCallback((): number => {
    const samples = history.current;
    if (samples.length < 2) return 0;
    const last = samples[samples.length - 1];
    let first = samples[0];
    for (let i = samples.length - 2; i >= 0; i -= 1) {
      first = samples[i];
      if (last.t - samples[i].t >= VELOCITY_WINDOW_MS) break;
    }
    const dt = last.t - first.t;
    if (dt <= 0) return 0;
    return ((last.y - first.y) / dt) * 1000;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (closing.current) return;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      // Catching a moving sheet must start from where it *is*, not where it was
      // headed, or the grab jumps.
      y.stop();
      grab.current = { pointerY: e.clientY, startY: y.get() };
      history.current = [{ y: y.get(), t: performance.now() }];
    },
    [y],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const g = grab.current;
      if (!g) return;
      const delta = e.clientY - g.pointerY;
      let next = g.startY + delta;
      // Past the top there is nothing more to reveal, so resist progressively
      // instead of stopping dead.
      if (next < 0) next = -rubberband(-next, height.current);
      y.set(next);
      history.current.push({ y: next, t: performance.now() });
      if (history.current.length > 8) history.current.shift();
    },
    [y],
  );

  const endDrag = useCallback(() => {
    if (!grab.current) return;
    grab.current = null;
    const velocity = releaseVelocity();
    // Decide against where the flick is *going*, not where the finger stopped.
    const projected = y.get() + project(velocity);
    const threshold = Math.min(MAX_DISMISS_THRESHOLD, height.current * DISMISS_FRACTION);
    if (projected > threshold) dismiss(velocity);
    else settle(0, velocity);
  }, [y, releaseVelocity, dismiss, settle]);

  const scrimOpacity = useTransform(y, (value) => {
    const h = height.current || 600;
    return Math.max(0, Math.min(1, 1 - value / h));
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') dismiss();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  return {
    y,
    scrimOpacity,
    sheetRef,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      // Claim vertical gestures so the browser does not start scrolling instead.
      style: { touchAction: 'none' },
    },
    dismiss,
  };
}
