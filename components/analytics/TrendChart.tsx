'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import type { DayPoint } from '@/lib/analytics-types';
import { SHOP_TIME_ZONE } from '@/lib/time';

/**
 * The shape of the last N days, drawn as one line under a wash of the accent.
 *
 * Deliberately not a bar chart. Bars invite reading each day against every
 * other day, which on a small crew means comparing a Tuesday with four Tasqs
 * to a Wednesday with three — noise, dressed as a finding. A smoothed line
 * says the only true thing at this sample size: which way the month is going.
 *
 * Hand-rolled SVG rather than a chart library. The whole thing is one path, one
 * fill and a handful of labels; a charting dependency to draw it would cost
 * more kilobytes than the rest of this screen put together, on a phone that is
 * often on shop wifi.
 *
 * The viewBox is measured rather than fixed, so one SVG user unit is one CSS
 * pixel. A fixed viewBox stretched to fit would turn the marker dot into an
 * ellipse on a wide screen and thin the stroke unevenly — the usual tell of a
 * chart that was drawn once at one size.
 */

const PAD_TOP = 10;
const PAD_BOTTOM = 16;
const MIN_H = 120;
const MAX_H = 176;

/** Catmull-Rom through the points, converted to cubic béziers. */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  let d = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    // Tension 6 keeps the curve from bulging past a peak it never reached —
    // a chart that invents a busier day than the shop had is a lie.
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(
      2,
    )},${p2.y.toFixed(2)}`;
  }
  return d;
}

const monthDay = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
});

/** "Mar 4" from a "YYYY-MM-DD" key, read as a plain date rather than an instant. */
function labelFor(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return monthDay.format(new Date(Date.UTC(y, m - 1, d, 12)));
}

export function TrendChart({
  series,
  label,
  tone = 'accent',
}: {
  series: DayPoint[];
  /** Names the figure for a screen reader — the drawing itself says nothing. */
  label: string;
  tone?: 'accent' | 'asap';
}) {
  const gradientId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const colour = tone === 'asap' ? 'var(--asap)' : 'var(--accent)';

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Shorter on a phone, taller where there is room — the same intent as a CSS
  // clamp, expressed here because the geometry needs the number too.
  const height = Math.round(Math.min(MAX_H, Math.max(MIN_H, width * 0.34)));

  const { points, path, area, peak, max, total } = useMemo(() => {
    const peakCount = Math.max(1, ...series.map((p) => p.count));
    const step = series.length > 1 ? width / (series.length - 1) : 0;
    const plot = height - PAD_TOP - PAD_BOTTOM;
    const pts = series.map((p, i) => ({
      x: series.length > 1 ? i * step : width / 2,
      y: PAD_TOP + plot - (p.count / peakCount) * plot,
    }));
    const line = smoothPath(pts);
    let peakIndex = 0;
    series.forEach((p, i) => {
      if (p.count > series[peakIndex].count) peakIndex = i;
    });
    return {
      points: pts,
      path: line,
      area:
        pts.length > 0
          ? `${line} L${pts[pts.length - 1].x.toFixed(2)},${height - PAD_BOTTOM} L${pts[0].x.toFixed(
              2,
            )},${height - PAD_BOTTOM} Z`
          : '',
      peak: peakIndex,
      max: peakCount,
      total: series.reduce((sum, p) => sum + p.count, 0),
    };
  }, [series, width, height]);

  const onPoint = useCallback(
    (clientX: number) => {
      const el = box.current;
      if (!el || series.length < 2) return;
      const rect = el.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      setHover(Math.max(0, Math.min(series.length - 1, Math.round(ratio * (series.length - 1)))));
    },
    [series.length],
  );

  if (series.length === 0) return null;

  const active = hover ?? peak;
  const activePoint = points[active];
  const activeDay = series[active];
  const flat = total === 0;

  return (
    <figure className="m-0">
      <div
        ref={box}
        style={{ height }}
        // A finger anywhere on the chart reads the day under it. Touch actions
        // stay default, so a scroll that starts on the chart still scrolls.
        onPointerMove={(e) => onPoint(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        {width > 0 ? (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            className="block"
            style={{ overflow: 'visible' }}
            role="img"
            aria-label={`${label}. ${total} finished in this window; busiest day ${labelFor(
              series[peak].date,
            )} with ${series[peak].count}.`}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colour} stopOpacity="0.28" />
                <stop offset="100%" stopColor={colour} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* The wash arrives after the line has drawn itself, so the eye
                follows the stroke first and the volume settles in behind it. */}
            <motion.path
              key={`area-${series.length}`}
              d={area}
              fill={`url(#${gradientId})`}
              initial={{ opacity: 0 }}
              animate={{ opacity: flat ? 0 : 1 }}
              transition={{ duration: 0.5, delay: 0.45, ease: 'easeOut' }}
            />

            <motion.path
              key={`line-${series.length}`}
              d={path}
              fill="none"
              stroke={colour}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.85, ease: [0.25, 0.1, 0.25, 1] }}
            />

            {!flat ? (
              <motion.g
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25, delay: 0.7 }}
              >
                {/* Plain attributes, not animated ones. The marker follows a
                    finger, and a spring between the last position and the next
                    would put it behind the fingertip — the one place on this
                    screen where an animation would make it feel worse. (It is
                    also the only way to keep these geometry attributes defined
                    on the very first frame, which an animated value is not.) */}
                <line
                  x1={activePoint.x}
                  x2={activePoint.x}
                  y1={PAD_TOP - 4}
                  y2={height - PAD_BOTTOM}
                  stroke="var(--hairline-bright)"
                  strokeWidth="1"
                />
                <circle
                  cx={activePoint.x}
                  cy={activePoint.y}
                  r="4"
                  fill={colour}
                  stroke="var(--ground)"
                  strokeWidth="2"
                />
              </motion.g>
            ) : null}
          </svg>
        ) : null}
      </div>

      <figcaption className="mt-2 flex items-baseline justify-between gap-3">
        <span className="type-caption shrink-0 text-[var(--text-tertiary)]">
          {labelFor(series[0].date)}
        </span>
        <span className="type-caption min-w-0 truncate text-center text-[var(--text-secondary)]">
          {flat ? (
            'Nothing finished yet'
          ) : (
            <>
              <span className="tabular" style={{ color: colour, fontWeight: 600 }}>
                {activeDay.count}
              </span>{' '}
              on {labelFor(activeDay.date)}
              {hover === null ? ' · busiest' : ''}
            </>
          )}
        </span>
        <span className="type-caption shrink-0 text-[var(--text-tertiary)]">
          {labelFor(series[series.length - 1].date)}
        </span>
      </figcaption>
      <span className="sr-only">
        Peak {max} in one day. Dates are {SHOP_TIME_ZONE} shop time.
      </span>
    </figure>
  );
}
