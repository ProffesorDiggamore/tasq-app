'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A horizontal carousel.
 *
 * Scrolling itself is left to the browser on purpose. Native momentum and the
 * platform's own rubber-band at the ends are better than anything hand-rolled
 * here, and taking the gesture over would mean fighting non-cancelable
 * touchmove on iOS mid-scroll — trading a good bounce for a hard stop on the
 * one device this is used on most. `overscroll-behavior-x: contain` keeps the
 * page from scroll-chaining without suppressing that bounce.
 *
 * What the platform does *not* give is any sign that there is more content past
 * an edge, so that part is ours: the content fades out under whichever edge it
 * continues past, and the fade appears only on the side that actually has more.
 */
const FADE_PX = 28;
/** A pixel or two of slack — scrollLeft is fractional on zoomed displays. */
const EPSILON = 2;

export function Rail({
  children,
  className = '',
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({
      start: el.scrollLeft > EPSILON,
      end: max > EPSILON && el.scrollLeft < max - EPSILON,
    });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    // Cards arriving, leaving, or the window resizing all change what is past
    // the edge, and none of those fire a scroll event.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [measure, children]);

  const start = edges.start ? `${FADE_PX}px` : '0px';
  const end = edges.end ? `${FADE_PX}px` : '0px';

  return (
    <div
      ref={ref}
      role={label ? 'group' : undefined}
      aria-label={label}
      className={`rail ${className}`}
      style={{
        // Unprefixed only — Lightning CSS adds -webkit- from the build targets.
        maskImage: `linear-gradient(to right, transparent 0, #000 ${start}, #000 calc(100% - ${end}), transparent 100%)`,
        transition: 'mask-image 180ms linear',
      }}
    >
      {children}
    </div>
  );
}
