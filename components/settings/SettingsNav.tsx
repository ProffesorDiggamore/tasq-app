'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { PressableLink } from '@/components/ui/PressableLink';
import { Rail } from '@/components/ui/Rail';
import { SPRING_ENTER } from '@/lib/motion';

export interface SettingsTab {
  key: string;
  label: string;
  /** Shown as a pill on the nav entry — waiting devices, people owed money. */
  badge?: number;
}

/**
 * The settings index.
 *
 * Two shapes of the same list. On anything wide enough — the shop Mac, an iPad
 * in landscape — it is a column down the left with the open section marked by a
 * rule, and the section itself sits beside it, so moving between sections never
 * costs the reader their place. On a phone there is no room for a column, so
 * the same list lies down as a scrolling strip of pills above the section, the
 * way the board's own tabs do.
 *
 * The open section lives in the URL rather than in state, so Back works, a
 * refresh stays put, and a link can point at one section.
 */
export function SettingsNav({
  tabs,
  current,
}: {
  tabs: SettingsTab[];
  current: string;
}) {
  // The strip is wider than a phone, so landing on a later section would
  // otherwise show a row of tabs with none of them marked — the open one is
  // off to the right. `nearest` on the block axis so bringing it into view
  // never scrolls the page itself away from the section header.
  const activePill = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    activePill.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [current]);

  return (
    <>
      {/* Phone: a strip above the content. */}
      <nav aria-label="Settings sections" className="md:hidden">
        <Rail className="flex gap-1.5 pb-1" label="Settings sections">
          {tabs.map((tab) => (
            <PressableLink
              key={tab.key}
              ref={tab.key === current ? activePill : undefined}
              href={`/settings?s=${tab.key}`}
              aria-current={tab.key === current ? 'page' : undefined}
              className="tap-target type-callout relative flex shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)] px-3.5"
              style={{
                color: tab.key === current ? 'var(--accent-ink)' : 'var(--text-secondary)',
              }}
            >
              {tab.key === current ? (
                <motion.span
                  layoutId="settings-tab-pill"
                  transition={SPRING_ENTER}
                  aria-hidden="true"
                  className="absolute inset-0 rounded-[var(--radius-pill)]"
                  style={{ background: 'var(--accent)' }}
                />
              ) : null}
              <span className="relative">{tab.label}</span>
              {tab.badge ? <Badge count={tab.badge} on={tab.key === current} /> : null}
            </PressableLink>
          ))}
        </Rail>
      </nav>

      {/* Desktop: a column beside the content. */}
      <nav
        aria-label="Settings sections"
        className="hidden w-[188px] shrink-0 md:block"
        style={{ position: 'sticky', top: '4.5rem', alignSelf: 'start' }}
      >
        <p className="type-label px-3 pb-2 text-[var(--text-tertiary)]">Settings</p>
        <ul className="flex flex-col">
          {tabs.map((tab) => {
            const selected = tab.key === current;
            return (
              <li key={tab.key} className="relative">
                {selected ? (
                  <motion.span
                    layoutId="settings-nav-rule"
                    transition={SPRING_ENTER}
                    aria-hidden="true"
                    className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full"
                    style={{ background: 'var(--accent)' }}
                  />
                ) : null}
                <PressableLink
                  href={`/settings?s=${tab.key}`}
                  surface
                  aria-current={selected ? 'page' : undefined}
                  className="tap-target flex w-full items-center gap-2 rounded-[var(--radius-control)] px-3"
                  style={{ color: selected ? 'var(--text)' : 'var(--text-secondary)' }}
                >
                  <span className="type-callout flex-1 truncate" style={{ fontWeight: selected ? 600 : 500 }}>
                    {tab.label}
                  </span>
                  {tab.badge ? <Badge count={tab.badge} on={false} /> : null}
                </PressableLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

/** On the selected pill the accent is already the background, so it inverts. */
function Badge({ count, on }: { count: number; on: boolean }) {
  return (
    <span
      className="type-caption tabular relative flex h-5 min-w-5 items-center justify-center rounded-[var(--radius-pill)] px-1.5"
      style={{
        background: on ? 'var(--accent-ink)' : 'var(--accent)',
        color: on ? 'var(--accent)' : 'var(--accent-ink)',
        fontWeight: 700,
      }}
    >
      {count}
    </span>
  );
}
