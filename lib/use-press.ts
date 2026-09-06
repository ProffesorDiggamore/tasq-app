'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Extra slop around the element before a press is considered dragged off.
 * Apple's rule of thumb: a finger that wobbles is still pressing.
 */
const SLOP_PX = 10;

/**
 * How long after a pointer-driven press a stray `click` is treated as its
 * echo rather than a new intent.
 *
 * Safari fires the compatibility `click` after the finger lifts, which is
 * AFTER a press that navigated has already swapped the page out. The click
 * then lands at the same screen coordinates on whatever the new screen put
 * there — sign in on the PIN pad and the board underneath opens whichever card
 * happened to sit under the last digit. Long enough to cover a route change
 * and its render; far shorter than any real second tap that would arrive with
 * a pointerdown of its own.
 */
const GHOST_CLICK_MS = 600;

let lastPointerPressAt = 0;

/**
 * Record that a press just fired from a pointer. Call this from any control
 * that commits on pointerdown/pointerup and can navigate — see PinKeypad,
 * which commits on down and so outruns its own click by the whole navigation.
 */
export function notePointerPress(): void {
  lastPointerPressAt = performance.now();
}

/**
 * True while a `click` arriving at a control that never saw a pointerdown is
 * more likely the echo of the press that brought this screen up than a real
 * activation.
 */
function withinGhostWindow(): boolean {
  return performance.now() - lastPointerPressAt < GHOST_CLICK_MS;
}

export interface PressHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onClick: () => void;
  'data-pressed': '' | undefined;
}

/**
 * Press feedback that lands on pointer-*down*, not on release, and survives the
 * finger wandering: drag past the slop and the press lifts, come back and it
 * returns, release outside and nothing fires.
 *
 * Deliberately does NOT call setPointerCapture. These buttons sit inside
 * horizontally scrolling carousels, and capturing the pointer would swallow the
 * swipe — a card would become impossible to scroll past. Without capture the
 * browser sends pointercancel the moment it takes the gesture over for
 * scrolling, which is exactly the signal we want.
 *
 * CSS `:active` is not enough on its own: on iOS it only applies under
 * conditions that are easy to lose, and it cannot express cancel-by-drag.
 */
export function usePress(onPress: () => void, disabled = false): {
  pressed: boolean;
  handlers: PressHandlers;
} {
  const [pressed, setPressed] = useState(false);
  const origin = useRef<DOMRect | null>(null);
  const active = useRef(false);
  // Keyboard and assistive tech fire click without ever sending pointerdown;
  // this keeps the two paths from both firing on a real tap.
  const handledByPointer = useRef(false);
  // Whether this element has ever been touched directly. A click without one is
  // either assistive tech or the ghost described above; the timing tells them
  // apart.
  const sawPointer = useRef(false);

  const clear = useCallback(() => {
    active.current = false;
    origin.current = null;
    setPressed(false);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      origin.current = (e.currentTarget as Element).getBoundingClientRect();
      active.current = true;
      sawPointer.current = true;
      setPressed(true);
    },
    [disabled],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!active.current || !origin.current) return;
    const r = origin.current;
    const outside =
      e.clientX < r.left - SLOP_PX ||
      e.clientX > r.right + SLOP_PX ||
      e.clientY < r.top - SLOP_PX ||
      e.clientY > r.bottom + SLOP_PX;
    // Reversible on purpose — dragging back onto the control re-arms it.
    setPressed(!outside);
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!active.current || disabled) {
        clear();
        return;
      }
      const r = origin.current;
      const inside =
        r !== null &&
        e.clientX >= r.left - SLOP_PX &&
        e.clientX <= r.right + SLOP_PX &&
        e.clientY >= r.top - SLOP_PX &&
        e.clientY <= r.bottom + SLOP_PX;
      clear();
      if (inside) {
        handledByPointer.current = true;
        notePointerPress();
        onPress();
      }
    },
    [clear, disabled, onPress],
  );

  const onClick = useCallback(() => {
    if (handledByPointer.current) {
      handledByPointer.current = false;
      return;
    }
    // Never touched, and a pointer press fired a moment ago on the screen this
    // one replaced: this is that press's trailing click, not a new one.
    if (!sawPointer.current && withinGhostWindow()) return;
    if (!disabled) onPress();
  }, [disabled, onPress]);

  return {
    pressed,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerLeave: clear,
      onPointerCancel: clear,
      onClick,
      'data-pressed': pressed ? '' : undefined,
    },
  };
}
