/**
 * Apple's fluid-interface physics, expressed in Motion's API.
 *
 * Apple parameterises springs as *damping ratio* (overshoot) and *response*
 * (how fast it reaches the target, in seconds) rather than mass/stiffness.
 * Motion's `bounce` + `duration` spring maps onto that directly: bounce 0 is
 * critically damped (damping 1.0), bounce ~0.2 is Apple's damping 0.8.
 *
 * The rule of thumb this encodes: critically damped everywhere by default,
 * bounce only where the gesture itself carried momentum.
 */
import type { Transition } from 'motion/react';

/** Reposition / move — Apple: damping 1.0, response 0.4. No overshoot. */
export const SPRING_MOVE: Transition = {
  type: 'spring',
  bounce: 0,
  duration: 0.4,
};

/** Drawer / sheet — Apple: damping 0.8, response 0.3. */
export const SPRING_SHEET: Transition = {
  type: 'spring',
  bounce: 0.2,
  duration: 0.3,
};

/** Something the user flicked. Bounce is earned because momentum preceded it. */
export const SPRING_FLICK: Transition = {
  type: 'spring',
  bounce: 0.25,
  duration: 0.4,
};

/** Non-gestural appearance (a row filling in). Quiet, no overshoot. */
export const SPRING_ENTER: Transition = {
  type: 'spring',
  bounce: 0,
  duration: 0.35,
};

/**
 * Where a flick is *going*, not where the finger left. Apple's exponential
 * decay from the Designing Fluid Interfaces sample code — not the textbook
 * v²/(2·decel), which lands noticeably short.
 */
export function project(initialVelocity: number, decelerationRate = 0.998): number {
  return ((initialVelocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Progressive resistance past a boundary. A hard stop reads as frozen; this
 * reads as "responsive, but there is nothing more here".
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** Pick the snap point nearest a projected landing position. */
export function nearestSnapPoint(projected: number, points: readonly number[]): number {
  return points.reduce((best, p) =>
    Math.abs(p - projected) < Math.abs(best - projected) ? p : best,
  );
}

/** Reads the media query once and stays in sync — used to drop springs entirely. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
