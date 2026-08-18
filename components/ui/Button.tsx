'use client';

import type { CSSProperties, ReactNode } from 'react';
import { usePress } from '@/lib/use-press';

/**
 * The one button in the app. Six near-identical implementations used to live in
 * the card, the sheet, the keypad, the settings list and the task form; tone and
 * size cover all of them, and press feedback is guaranteed to be identical
 * everywhere as a result.
 */
export type ButtonTone = 'primary' | 'secondary' | 'quiet' | 'danger' | 'plain';
export type ButtonSize = 'sm' | 'md' | 'lg';

const HEIGHT: Record<ButtonSize, string> = {
  sm: 'h-11',
  md: 'h-12',
  lg: 'h-14',
};

function toneStyle(tone: ButtonTone): CSSProperties {
  switch (tone) {
    case 'primary':
      return {
        background: 'var(--accent)',
        color: 'var(--accent-ink)',
        border: '1px solid transparent',
      };
    case 'secondary':
      return {
        background: 'var(--surface-strong)',
        color: 'var(--text)',
        border: '1px solid var(--hairline)',
      };
    case 'quiet':
      return {
        background: 'var(--surface-strong)',
        color: 'var(--text-secondary)',
        border: '1px solid var(--hairline)',
      };
    case 'danger':
      return {
        background: 'color-mix(in srgb, var(--danger) 16%, transparent)',
        color: 'var(--danger)',
        border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
      };
    case 'plain':
      return { background: 'transparent', color: 'inherit', border: '1px solid transparent' };
  }
}

export interface ButtonProps {
  children: ReactNode;
  onPress: () => void;
  tone?: ButtonTone;
  size?: ButtonSize;
  disabled?: boolean;
  /** Pills for chips and floating actions, rounded rect for everything else. */
  pill?: boolean;
  fullWidth?: boolean;
  grow?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  'aria-pressed'?: boolean;
  'aria-expanded'?: boolean;
}

export function Button({
  children,
  onPress,
  tone = 'secondary',
  size = 'sm',
  disabled = false,
  pill = false,
  fullWidth = false,
  grow = false,
  type = 'button',
  className = '',
  style,
  ...aria
}: ButtonProps) {
  const { pressed, handlers } = usePress(onPress, disabled);

  return (
    <button
      type={type}
      disabled={disabled}
      {...handlers}
      {...aria}
      className={`type-callout tap-target flex items-center justify-center px-4 disabled:opacity-45 ${
        HEIGHT[size]
      } ${fullWidth ? 'w-full' : ''} ${grow ? 'flex-1' : ''} ${className}`}
      style={{
        borderRadius: pill ? 'var(--radius-pill)' : 'var(--radius-control)',
        fontWeight: tone === 'primary' ? 600 : 500,
        ...toneStyle(tone),
        ...style,
      }}
    >
      {/* Scaling an inner span rather than the button keeps the hit area still
          while the press is held — the target must not shrink away from the finger. */}
      <span
        className="press-scale flex items-center justify-center gap-2"
        data-pressed={pressed ? '' : undefined}
      >
        {children}
      </span>
    </button>
  );
}
