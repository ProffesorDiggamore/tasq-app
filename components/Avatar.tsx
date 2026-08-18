import type { CSSProperties } from 'react';

/**
 * Five people who all know each other — initials read faster than photos and
 * cost nothing to keep current when someone joins.
 */
const TINTS = [
  '#0a84ff',
  '#ff9f0a',
  '#30d158',
  '#bf5af2',
  '#64d2ff',
  '#ff375f',
  '#ffd60a',
] as const;

export function avatarTint(userId: number): string {
  return TINTS[userId % TINTS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  userId,
  size = 44,
  className = '',
  style,
}: {
  name: string;
  userId: number;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const tint = avatarTint(userId);
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${className}`}
      style={{
        width: size,
        height: size,
        // Tinted glass rather than a solid disc, so it belongs to the material layer.
        background: `color-mix(in srgb, ${tint} 26%, transparent)`,
        color: tint,
        border: `1px solid color-mix(in srgb, ${tint} 42%, transparent)`,
        fontSize: Math.round(size * 0.36),
        letterSpacing: '0.01em',
        ...style,
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
