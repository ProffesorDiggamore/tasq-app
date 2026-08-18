'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useAnimate } from 'motion/react';
import { PIN_LENGTH } from '@/lib/auth/pin.client';
import { haptic } from '@/lib/haptics';
import { prefersReducedMotion, SPRING_MOVE } from '@/lib/motion';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', null, '0', 'del'] as const;

export interface PinKeypadProps {
  /** What the person is being asked for right now. */
  prompt: string;
  /** Set when the last attempt failed; drives the shake and the message. */
  error: string | null;
  /** Bumped by the parent on every failure so repeated identical errors still shake. */
  errorNonce: number;
  disabled: boolean;
  busy: boolean;
  onComplete: (pin: string) => void;
}

export function PinKeypad({
  prompt,
  error,
  errorNonce,
  disabled,
  busy,
  onComplete,
}: PinKeypadProps) {
  const [buffer, setBuffer] = useState('');
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const lastNonce = useRef(errorNonce);

  const press = useCallback(
    (key: string) => {
      if (disabled || busy) return;
      if (key === 'del') {
        haptic('tap');
        setBuffer((b) => b.slice(0, -1));
        return;
      }
      setBuffer((b) => {
        if (b.length >= PIN_LENGTH) return b;
        haptic('tap');
        return b + key;
      });
    },
    [disabled, busy],
  );

  // Submit only once the fourth dot has actually painted — the person should see
  // their last digit land before the screen does anything else.
  useEffect(() => {
    if (buffer.length !== PIN_LENGTH) return;
    const id = requestAnimationFrame(() => onComplete(buffer));
    return () => cancelAnimationFrame(id);
  }, [buffer, onComplete]);

  // Clear and shake when the parent reports a failure.
  useEffect(() => {
    if (errorNonce === lastNonce.current) return;
    lastNonce.current = errorNonce;
    setBuffer('');
    haptic('error');
    if (prefersReducedMotion() || !scope.current) return;
    void animate(
      scope.current,
      { x: [0, -12, 9, -6, 3, 0] },
      { duration: 0.4, ease: [0.36, 0.07, 0.19, 0.97] },
    );
  }, [errorNonce, animate, scope]);

  // Clear the pad when it becomes disabled (lockout) so nothing is left mid-entry.
  useEffect(() => {
    if (disabled) setBuffer('');
  }, [disabled]);

  // A physical keyboard is the fastest input on the shop Mac.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        press(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        press('del');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  return (
    <div ref={scope} className="flex w-full flex-col items-center">
      <p className="type-callout text-center text-[var(--text-secondary)]">{prompt}</p>

      <div
        className="mt-5 flex items-center justify-center gap-4"
        role="status"
        aria-live="polite"
        aria-label={`${buffer.length} of ${PIN_LENGTH} digits entered`}
      >
        {Array.from({ length: PIN_LENGTH }, (_, i) => {
          const filled = i < buffer.length;
          return (
            <motion.span
              key={i}
              className="block rounded-full"
              style={{
                width: 14,
                height: 14,
                border: '1.5px solid var(--hairline-bright)',
              }}
              animate={{
                backgroundColor: filled
                  ? error
                    ? 'var(--danger)'
                    : 'var(--text)'
                  : 'rgba(0,0,0,0)',
                scale: filled ? 1 : 0.82,
              }}
              transition={SPRING_MOVE}
            />
          );
        })}
      </div>

      <p
        className="type-caption mt-3 h-5 text-center"
        style={{ color: error ? 'var(--danger)' : 'var(--text-tertiary)' }}
        role="alert"
      >
        {error ?? (busy ? 'Checking…' : '')}
      </p>

      <div className="mt-4 grid w-full max-w-[19rem] grid-cols-3 gap-3">
        {KEYS.map((key, i) =>
          key === null ? (
            <span key={`gap-${i}`} aria-hidden="true" />
          ) : (
            <KeypadKey
              key={key}
              value={key}
              disabled={disabled || busy}
              onPress={press}
            />
          ),
        )}
      </div>
    </div>
  );
}

function KeypadKey({
  value,
  disabled,
  onPress,
}: {
  value: string;
  disabled: boolean;
  onPress: (key: string) => void;
}) {
  const isDelete = value === 'del';
  return (
    <button
      type="button"
      // Feedback and commit both happen on the press. Waiting for pointerup on a
      // keypad feels dead, and there is nothing to cancel on a digit.
      onPointerDown={(e) => {
        e.preventDefault();
        onPress(value);
      }}
      // Keyboard and assistive tech never see pointerdown; click covers them
      // without double-firing, because pointerdown calls preventDefault().
      onClick={() => onPress(value)}
      disabled={disabled}
      aria-label={isDelete ? 'Delete' : value}
      className="pressable tap-target flex h-16 items-center justify-center rounded-[var(--radius-control)] disabled:opacity-40"
      style={{
        background: isDelete ? 'transparent' : 'var(--surface)',
        border: isDelete ? '1px solid transparent' : '1px solid var(--hairline)',
        fontSize: isDelete ? '1.0625rem' : '1.6rem',
        fontWeight: isDelete ? 500 : 400,
        letterSpacing: isDelete ? '0.01em' : '-0.01em',
        fontVariantNumeric: 'tabular-nums',
        color: isDelete ? 'var(--text-secondary)' : 'var(--text)',
      }}
    >
      {isDelete ? 'Delete' : value}
    </button>
  );
}
