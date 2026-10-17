'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { PressableLink } from '@/components/ui/PressableLink';
import { Rail } from '@/components/ui/Rail';
import { SPRING_ENTER } from '@/lib/motion';
import type { GroupTab } from '@/lib/board-types';

/**
 * The tabs across the top of the board: the shared Tasqs tab, then whichever
 * groups this person is in. Navigation rather than local state, because the
 * board is a server render — the tab lives in the URL so a refresh, a
 * notification deep link, and the thirty-second poll all land back on the tab
 * the person was looking at.
 *
 * Renders nothing when there are no groups, so a shop that never makes one
 * never sees a tab strip it has no use for.
 *
 * The strip is centred while it fits and scrolls horizontally once it does
 * not, which is the normal state on a phone for a shop with more than about
 * three groups. Landing on a later group would then show a row of tabs with
 * none of them marked, so the open one is scrolled into the middle on arrival.
 */
export function BoardTabs({
  tabs,
  current,
}: {
  tabs: GroupTab[];
  /** Null is the shared Tasqs tab. */
  current: number | null;
}) {
  // Hooks run before the early return — React requires the same hooks every
  // render, and this component goes from no tabs to some the moment an admin
  // makes the first group.
  const activePill = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    // `nearest` on the block axis so pulling a tab into view never scrolls the
    // board itself away from the top.
    activePill.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [current]);

  if (tabs.length === 0) return null;

  const all: { id: number | null; name: string }[] = [{ id: null, name: 'Tasqs' }, ...tabs];

  return (
    <nav
      aria-label="Board tabs"
      className="mx-auto w-full max-w-5xl pt-1"
      style={{ paddingInline: 'var(--gutter)' }}
      data-tour="tabs"
    >
      <Rail className="rail-center flex gap-1.5 pb-1" label="Board tabs">
        {all.map((tab) => {
          const selected = tab.id === current;
          return (
            <PressableLink
              key={tab.id ?? 'shared'}
              ref={selected ? activePill : undefined}
              href={tab.id === null ? '/' : `/?g=${tab.id}`}
              aria-current={selected ? 'page' : undefined}
              className="tap-target type-callout relative flex shrink-0 items-center rounded-[var(--radius-pill)] px-3.5"
              style={{ color: selected ? 'var(--accent-ink)' : 'var(--text-secondary)' }}
            >
              {/* One shared layoutId, so the pill slides between tabs instead of
                  cross-fading — the movement is what says "same thing, moved". */}
              {selected ? (
                <motion.span
                  layoutId="board-tab-pill"
                  transition={SPRING_ENTER}
                  aria-hidden="true"
                  className="absolute inset-0 rounded-[var(--radius-pill)]"
                  style={{ background: 'var(--accent)' }}
                />
              ) : null}
              <span className="relative truncate" style={{ maxWidth: '11rem' }}>
                {tab.name}
              </span>
            </PressableLink>
          );
        })}
      </Rail>
    </nav>
  );
}
