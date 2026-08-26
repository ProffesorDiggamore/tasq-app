'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/Button';
import { setThemeAction } from '@/app/settings/actions';
import { haptic } from '@/lib/haptics';
import { SPRING_ENTER } from '@/lib/motion';

export interface ThemeOption {
  key: string;
  label: string;
  accent: string;
  ink: string;
}

/** One row of swatches. Selection is springy; applying repaints the whole app. */
export function ThemeCard({ current, themes }: { current: string; themes: ThemeOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <section>
      <h2 className="type-label px-1 text-[var(--text-tertiary)]">Theme</h2>
      <div className="material-card mt-2.5 rounded-[var(--radius-card)] p-4">
        <div className="flex flex-wrap gap-3">
          {themes.map((t) => {
            const selected = t.key === current;
            return (
              <Button
                key={t.key}
                tone="quiet"
                aria-pressed={selected}
                aria-label={`${t.label} theme`}
                disabled={pending}
                onPress={() => {
                  if (selected) return;
                  haptic('commit');
                  startTransition(async () => {
                    await setThemeAction(t.key);
                    router.refresh();
                  });
                }}
                className="relative flex items-center gap-2 rounded-full px-2 py-2"
                style={{
                  background: selected ? 'var(--surface-strong)' : 'transparent',
                  border: `1px solid ${selected ? 'var(--hairline)' : 'transparent'}`,
                }}
              >
                <motion.span
                  layout
                  transition={SPRING_ENTER}
                  className="block h-7 w-7 rounded-full"
                  style={{ background: t.accent }}
                />
                {selected ? (
                  <span className="type-caption pr-1">{t.label}</span>
                ) : null}
              </Button>
            );
          })}
        </div>
        <p className="type-caption mt-3 text-[var(--text-tertiary)]">
          Changes for everyone, everywhere the accent shows up.
        </p>
      </div>
    </section>
  );
}
