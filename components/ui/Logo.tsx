import { LOGO_PATHS, LOGO_VIEWBOX } from '@/lib/logo-mark';

/**
 * The Tasq mark, with no ground of its own.
 *
 * Defaults to `currentColor`, which is the only variant that actually matters
 * in the app: drop it anywhere and it inherits the ink of whatever it sits in,
 * so it is black on the light theme, white on the dark one, and the accent
 * colour when a parent sets that — without a second file or a theme lookup.
 * The fixed-colour files (public/logo.svg, public/logo-white.svg) exist for
 * everything *outside* the app: docs, a README, a listing, a printed sign.
 */
export function Logo({
  size = 40,
  tone = 'current',
  title,
  className,
}: {
  /** Rendered width and height in px; the mark is square. */
  size?: number;
  /** `current` inherits the surrounding text colour. */
  tone?: 'current' | 'light' | 'dark';
  /** Give it a name when the logo is the only thing identifying something. */
  title?: string;
  className?: string;
}) {
  const fill = tone === 'light' ? '#ffffff' : tone === 'dark' ? '#141414' : 'currentColor';
  return (
    <svg
      width={size}
      height={size}
      viewBox={LOGO_VIEWBOX}
      fill={fill}
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {LOGO_PATHS.map((d) => (
        <path key={d.slice(0, 24)} d={d} />
      ))}
    </svg>
  );
}
