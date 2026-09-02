'use client';

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { prefersReducedMotion, SPRING_SHEET } from '@/lib/motion';

/**
 * A green ring that draws itself, then a checkmark strokes across it. Used at
 * the moments the app confirms something irreversible went right — the PIN was
 * saved, the board was activated — where a plain redirect leaves an older
 * person unsure it worked.
 *
 * Reduced motion gets the finished mark with no drawing.
 */
export function SuccessCheck({
  size = 76,
  label = 'Done',
}: {
  size?: number;
  label?: string;
}) {
  const [reduce, setReduce] = useState(false);
  useEffect(() => setReduce(prefersReducedMotion()), []);

  const from = reduce ? 1 : 0;

  return (
    <motion.div
      role="status"
      aria-label={label}
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={SPRING_SHEET}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox="0 0 52 52" fill="none" aria-hidden="true">
        <motion.circle
          cx="26"
          cy="26"
          r="24"
          stroke="var(--success)"
          strokeWidth="3"
          strokeLinecap="round"
          initial={{ pathLength: from, rotate: -90 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: reduce ? 0 : 0.45, ease: 'easeInOut' }}
          style={{ transformOrigin: 'center' }}
        />
        <motion.path
          d="M15 27 l7.5 7.5 L37 18"
          stroke="var(--success)"
          strokeWidth="3.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: from }}
          animate={{ pathLength: 1 }}
          transition={{ duration: reduce ? 0 : 0.28, delay: reduce ? 0 : 0.34, ease: 'easeOut' }}
        />
      </svg>
    </motion.div>
  );
}
