'use client';

import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

/**
 * A number that counts up to itself when it appears.
 *
 * This is the whole point of the screen in one component: "34" printed on a
 * card is a fact, and "0 … 31 … 34" landing under your thumb is a small piece
 * of evidence that the week went somewhere. It runs on rAF rather than a
 * spring because the value has to hit its target exactly — an overshoot here
 * would show a count the reader knows is wrong.
 *
 * Written on a rAF loop rather than a state tick per frame so a screen full of
 * these costs one render each, not sixty.
 */
export function CountUp({
  value,
  duration = 900,
  format = (n: number) => String(n),
  className,
  style,
}: {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const node = useRef<HTMLSpanElement>(null);
  // The rendered fallback is the final value, so a reader with JS still
  // parsing — or reduced motion on — never sees a zero that stays a zero.
  const [initial] = useState(value);
  // Starts at zero so the first paint after hydration is the count-up itself;
  // afterwards it holds the last value shown, so a range switch counts from
  // the number already on screen rather than restarting at nothing.
  const from = useRef(0);

  useEffect(() => {
    const el = node.current;
    if (!el) return;
    const target = value;
    const start = from.current;
    from.current = target;

    if (prefersReducedMotion() || start === target) {
      el.textContent = format(target);
      return;
    }

    let frame = 0;
    const began = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - began) / duration);
      // Ease-out cubic: fast enough to feel like a result, settled enough at
      // the end that the last few digits are readable rather than a blur.
      const eased = 1 - (1 - p) ** 3;
      el.textContent = format(Math.round(start + (target - start) * eased));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, format]);

  return (
    <span ref={node} className={className} style={style}>
      {format(initial)}
    </span>
  );
}
