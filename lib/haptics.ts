/**
 * Haptics fire on the causal event and on the same frame as the visual, or not
 * at all — latency between the senses destroys the illusion. Reserved for
 * commits (claim, accept, complete) and errors, never for ordinary taps:
 * over-feedback trains people to ignore all of it.
 */
export type HapticKind = 'tap' | 'commit' | 'error';

const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 8,
  commit: [10, 40, 18],
  error: [24, 60, 24],
};

export function haptic(kind: HapticKind): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  navigator.vibrate(PATTERNS[kind]);
}
