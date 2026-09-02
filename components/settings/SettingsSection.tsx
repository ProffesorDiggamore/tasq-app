import type { ReactNode } from 'react';

/**
 * The header every settings section opens with: what this page is, and one
 * sentence on what changing it does. The old settings screen was one long
 * scroll of cards with no such statement, so a card like "Theme" had to carry
 * both its name and its consequence in a caption underneath itself.
 */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 flex-1">
      <header className="pb-5" style={{ borderBottom: '1px solid var(--hairline)' }}>
        <h2 className="type-title">{title}</h2>
        <p className="type-callout mt-1 text-[var(--text-secondary)]">{description}</p>
      </header>
      <div className="flex flex-col gap-7 pt-6">{children}</div>
    </section>
  );
}
