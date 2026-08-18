'use client';

import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * `reducedMotion="user"` makes Motion drop transform and layout animations for
 * anyone who asked the OS for less motion, while leaving opacity and colour
 * alone. The stylesheet already handles CSS transitions; without this the
 * spring-driven animations would ignore the preference entirely.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
