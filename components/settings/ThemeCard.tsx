'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/Button';
import { setAppearanceAction, setThemeAction } from '@/app/settings/actions';
import { haptic } from '@/lib/haptics';
import { SPRING_ENTER } from '@/lib/motion';

export interface ThemeOption {
  key: string;
  label: string;
  accent: string;
  ink: string;
}

export interface AppearanceOption {
  key: string;
  label: string;
}

/** One card: appearance (auto/light/dark) on top, accent swatches below. */
export function ThemeCard({
  current,
  appearance,
  themes,
  appearances,
}: {
  current: string;
  appearance: string;
  themes: ThemeOption[];
  appearances: AppearanceOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <section>
      <h2 className="type-label px-1 text-[var(--text-tertiary)]">Theme</h2>
      <div className="material-card mt-2.5 rounded-[var(--radius-card)] p-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Appearance">
          {appearances.map((a) => {
            const selected = a.key === appearance;
            return (
              <Button
                key={a.key}
                tone="quiet"
                aria-pressed={selected}
                aria-label={`${a.label} appearance`}
                disabled={pending}
                onPress={() => {
                  if (selected) return;
                  haptic('commit');
                  startTransition(async () => {
                    await setAppearanceAction(a.key);
                    router.refresh();
                  });
                }}
                className="tap-target flex items-center rounded-full px-3"
                style={{
                  background: selected ? 'var(--surface-strong)' : 'transparent',
                  border: `1px solid ${selected ? 'var(--hairline)' : 'transparent'}`,
                }}
              >
                <span className={`type-callout ${selected ? '' : 'text-[var(--text-secondary)]'}`}>
                  {a.label}
                </span>
              </Button>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
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
          Changes for everyone. Auto follows each device's light or dark setting.
        </p>
      </div>
    </section>
  );
}
