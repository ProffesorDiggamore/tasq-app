'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { SuccessCheck } from '@/components/ui/SuccessCheck';
import { haptic } from '@/lib/haptics';
import { usePress } from '@/lib/use-press';
import { prefersReducedMotion, SPRING_SHEET } from '@/lib/motion';
import { TOUR_STEPS, type TourStep } from '@/lib/tour-steps';
import { markTourCompleteAction } from '@/app/actions';

const PAD = 8; // gap between the target and the spotlight ring
const CARD_GAP = 14; // gap between the spotlight and the caption card
const FULL_INSET = 10; // margin around a whole-screen spotlight

/**
 * Coach marks over the live board. Dims the screen, cuts a hole around the real
 * button being explained, and floats one sentence next to it. Advances on a tap
 * anywhere, Back and Skip on the card. Targets that are not on the page right
 * now are skipped without a gap in the numbering.
 */
export function BoardTour({
  autostart,
  isAdmin,
  firstName,
}: {
  autostart: boolean;
  isAdmin: boolean;
  firstName: string;
}) {
  // Optional steps are dropped once, at mount, by asking the DOM whether their
  // target exists — so the progress dots match the steps that will actually be
  // shown. Doing it lazily instead meant a dot the tour jumped straight over.
  const [dropped, setDropped] = useState<readonly string[]>([]);
  const steps = useMemo(
    () => TOUR_STEPS.filter((s) => (!s.adminOnly || isAdmin) && !dropped.includes(s.key)),
    [isAdmin, dropped],
  );

  const [active, setActive] = useState(autostart);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [reduce, setReduce] = useState(false);
  const [vw, setVw] = useState(1024);
  const [vh, setVh] = useState(768);
  const [mounted, setMounted] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    setReduce(prefersReducedMotion());
    setVw(window.innerWidth);
    setVh(window.innerHeight);
    setDropped(
      TOUR_STEPS.filter(
        (s) => s.optional && s.target && !document.querySelector(`[data-tour="${s.target}"]`),
      ).map((s) => s.key),
    );
  }, []);

  const step: TourStep | undefined = steps[i];

  const finish = useCallback(() => {
    setActive(false);
    haptic('commit');
    // Mark tour as complete for this user
    void markTourCompleteAction();
    if (typeof window !== 'undefined' && window.location.search.includes('tour')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const go = useCallback(
    (delta: number) => {
      setI((x) => {
        const next = x + delta;
        if (next < 0) return 0;
        return next;
      });
    },
    [],
  );

  const advance = useCallback(() => {
    if (i >= steps.length - 1) {
      finish();
      return;
    }
    haptic('tap');
    go(1);
  }, [i, steps.length, finish, go]);

  // Resolve the current target, bring it on screen, and keep the rect in sync
  // with scroll and resize. A missing target (e.g. an empty Done row) skips.
  useEffect(() => {
    if (!active || !step) return;
    let cancelled = false;

    if (step.target === null) {
      setRect(null);
      return;
    }
    setRect(null);

    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!el) {
      // Nothing to point at yet. Wait a beat for a late-mounting row, then show
      // it. If it never arrives — an empty board has no cards and no Done row —
      // the step is still shown, centred, with nothing ringed: on a board with
      // no work, silently jumping three steps read as the tour being broken.
      // A plain timeout with a cleanup, not a microtask, so Strict Mode's
      // double-invoke cannot advance twice.
      const t = window.setTimeout(() => {
        if (cancelled) return;
        const late = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
        setRect(late ? late.getBoundingClientRect() : null);
      }, 140);
      return () => {
        cancelled = true;
        window.clearTimeout(t);
      };
    }

    const measure = () => {
      if (!cancelled) setRect(el.getBoundingClientRect());
    };
    el.scrollIntoView({
      behavior: reduce ? 'auto' : 'smooth',
      block: 'center',
      inline: 'center',
    });
    const settle = window.setTimeout(measure, reduce ? 0 : 360);
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelled = true;
      window.clearTimeout(settle);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [active, step, reduce]);

  useEffect(() => {
    const onResize = () => {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Keyboard: the shop Mac is driven by one.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        advance();
      } else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, advance, finish, go]);

  useEffect(() => {
    if (active && !startedRef.current) {
      startedRef.current = true;
      haptic('tap');
    }
  }, [active]);

  if (!active || !step || !mounted) return null;

  const spring = reduce ? { duration: 0 } : SPRING_SHEET;
  const total = steps.length;

  // The spotlight box. With no target it collapses to screen-centre and the
  // huge box-shadow simply dims everything.
  const box = step.full
    ? { top: FULL_INSET, left: FULL_INSET, width: vw - FULL_INSET * 2, height: vh - FULL_INSET * 2 }
    : rect
      ? {
          top: rect.top - PAD,
          left: rect.left - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
        }
      : { top: vh / 2, left: vw / 2, width: 0, height: 0 };

  // Caption placement.
  const cardW = Math.min(340, vw - 32);
  // A target taller than most of the screen has no "above" or "below" left to
  // put a card in — the three board rows together are taller than a phone. The
  // ring already says what is being pointed at, so the card goes to the middle
  // rather than off the bottom edge where the first version of this put it.
  const tall = rect !== null && rect.height > vh * 0.6;

  let cardStyle: React.CSSProperties;
  if (!rect || step.full || tall) {
    cardStyle = {
      left: (vw - cardW) / 2,
      top: Math.max(24, vh / 2 - 150),
      width: cardW,
    };
  } else {
    const below = step.place === 'below' || (step.place !== 'above' && rect.top < vh / 2);
    const cx = rect.left + rect.width / 2;
    const left = Math.min(Math.max(16, cx - cardW / 2), vw - 16 - cardW);
    cardStyle = below
      ? { left, top: rect.bottom + PAD + CARD_GAP, width: cardW }
      : { left, bottom: vh - rect.top + PAD + CARD_GAP, width: cardW };
  }

  // Portal to the body: any ancestor with a transform (page transitions,
  // sheets) would become this overlay's containing block and shrink the
  // `fixed inset-0` trap to that box, throwing the caption card off-screen
  // with no way out.
  return createPortal(
    <div
      className="fixed inset-0 z-[70]"
      // Swallows taps so nothing on the board fires mid-tour, but does not itself
      // advance: a shaky tap on the dim area must not skip three steps at once.
      style={{ pointerEvents: 'auto' }}
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label="Board walkthrough"
    >
      {/* Dimmer + spotlight ring in one element: a 100vmax box-shadow. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none fixed rounded-[16px]"
        initial={false}
        animate={box}
        transition={spring}
        style={{
          boxShadow: '0 0 0 100vmax rgba(0,0,0,0.74)',
          border: rect || step.full ? '2px solid rgba(255,255,255,0.92)' : 'none',
        }}
      />

      {/* Keyed, not wrapped in AnimatePresence: the card is remounted on every
          step so there is never a frame with no card — a fast double-tap on
          Next can't land in a gap and hit a stale handler. */}
      <motion.div
          key={step.key}
          className="material-sheet fixed rounded-[var(--radius-card)] p-4"
          style={cardStyle}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          transition={reduce ? { duration: 0 } : SPRING_SHEET}
          onClick={(e) => e.stopPropagation()}
        >
        {step.kind === 'outro' ? (
          <div className="flex flex-col items-center pb-1 text-center">
            <SuccessCheck size={64} label="Tour finished" />
          </div>
        ) : null}

        <h2 className="type-headline mt-1 text-center">
          {step.kind === 'intro' ? `Welcome, ${firstName}` : step.title}
        </h2>
        <p className="type-callout mt-1.5 text-center text-[var(--text-secondary)]">
          {step.body}
        </p>

        <div className="mt-4 flex items-center gap-2">
          {i > 0 && step.kind !== 'outro' ? (
            <TourButton onPress={() => go(-1)} className="tap-target type-callout rounded-[var(--radius-pill)] px-3 text-[var(--text-secondary)]">
              Back
            </TourButton>
          ) : null}
          <div className="flex flex-1 justify-center gap-1.5" aria-hidden="true">
            {steps.map((s, n) => (
              <span
                key={s.key}
                className="block h-1.5 rounded-full"
                style={{
                  width: n === i ? 16 : 6,
                  background: n === i ? 'var(--accent)' : 'var(--hairline-bright)',
                  transition: reduce ? undefined : 'width 160ms ease',
                }}
              />
            ))}
          </div>
          <TourButton
            onPress={advance}
            className="tap-target type-callout rounded-[var(--radius-pill)] px-4"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 600 }}
          >
            {i >= total - 1 ? 'Start' : 'Next'}
          </TourButton>
        </div>

        {step.kind !== 'outro' ? (
          <TourButton
            onPress={finish}
            className="tap-target type-caption mt-1 block w-full text-center text-[var(--text-tertiary)]"
          >
            Skip the tour
          </TourButton>
        ) : null}
      </motion.div>
    </div>,
    document.body,
  );
}

/** Press feedback for the tour card's own chrome, identical to every other
 *  button in the app. Purely presentational — step logic stays above. */
function TourButton({
  onPress,
  className,
  style,
  children,
}: {
  onPress: () => void;
  className: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const { pressed, handlers } = usePress(onPress);
  return (
    <button
      type="button"
      {...handlers}
      data-pressed={pressed ? '' : undefined}
      className={`press-scale ${className}`}
      style={style}
    >
      {children}
    </button>
  );
}
