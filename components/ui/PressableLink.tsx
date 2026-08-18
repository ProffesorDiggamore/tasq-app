'use client';

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { usePress } from '@/lib/use-press';
import { useRouter } from 'next/navigation';

/**
 * A link that presses like a button. Navigation still goes through next/link so
 * prefetching and middle-click keep working; the press hook only supplies the
 * feedback, and a drag off the target cancels the navigation the same way it
 * cancels a button.
 */
export function PressableLink({
  href,
  children,
  className = '',
  style,
  surface = false,
  ...aria
}: {
  href: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Whole-surface targets scale and tint together; small chrome only scales. */
  surface?: boolean;
  'aria-label'?: string;
}) {
  const router = useRouter();
  const { pressed, handlers } = usePress(() => router.push(href));

  return (
    <Link
      href={href}
      {...handlers}
      // The hook already navigated on pointer-up; let it own the single commit.
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        handlers.onClick();
      }}
      data-pressed={pressed ? '' : undefined}
      className={`${surface ? 'press-surface' : 'press press-scale'} ${className}`}
      style={style}
      {...aria}
    >
      {children}
    </Link>
  );
}
