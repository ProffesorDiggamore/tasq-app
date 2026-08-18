import { PressableLink } from '@/components/ui/PressableLink';

export interface SettingsLink {
  href: string;
  label: string;
  hint: string;
  badge?: number;
}

/** Named for their contents rather than a vague umbrella, so what is behind each is predictable. */
export function SettingsLinks({ links }: { links: SettingsLink[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {links.map((link) => (
        <li key={link.href}>
          <PressableLink
            href={link.href}
            surface
            className="material-card tap-target flex w-full items-center gap-3 rounded-[var(--radius-card)] px-4 py-3.5"
          >
            <span className="min-w-0 flex-1">
              <span className="type-headline block">{link.label}</span>
              <span className="type-caption block text-[var(--text-tertiary)]">{link.hint}</span>
            </span>
            {link.badge ? (
              <span
                className="type-caption tabular flex h-5 min-w-5 items-center justify-center rounded-[var(--radius-pill)] px-1.5"
                style={{ background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 700 }}
              >
                {link.badge}
              </span>
            ) : null}
            <svg width="8" height="14" viewBox="0 0 8 14" fill="none" aria-hidden="true" style={{ color: 'var(--text-tertiary)' }}>
              <path d="M1 1l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </PressableLink>
        </li>
      ))}
    </ul>
  );
}
