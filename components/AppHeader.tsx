'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Avatar } from '@/components/Avatar';
import { switchUserAction } from '@/app/login/actions';

/**
 * Translucent chrome the content scrolls *under*, rather than an opaque bar that
 * eats a strip of a phone screen. The fade below it stands in for a 1px rule.
 */
export function AppHeader({
  userId,
  userName,
  isAdmin,
  title,
  backHref,
}: {
  userId: number;
  userName: string;
  isAdmin: boolean;
  title: string;
  backHref?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function switchUser() {
    startTransition(async () => {
      await switchUserAction();
      router.replace('/login');
      router.refresh();
    });
  }

  return (
    <header className="sticky top-0 z-30">
      <div className="material-chrome flex items-center gap-3 px-4 py-2.5">
        {backHref ? (
          <Link
            href={backHref}
            className="pressable tap-target type-callout -ml-2 flex items-center rounded-[var(--radius-pill)] px-3 text-[var(--accent)]"
          >
            Back
          </Link>
        ) : (
          <Link
            href="/settings"
            aria-label="Settings"
            className="pressable tap-target -ml-2 flex items-center rounded-[var(--radius-pill)] px-2"
          >
            <GearIcon />
          </Link>
        )}

        <h1 className="type-headline flex-1 truncate text-center">{title}</h1>

        <button
          type="button"
          onClick={switchUser}
          disabled={pending}
          aria-label={`Switch user — currently ${userName}`}
          className="pressable tap-target -mr-2 flex items-center gap-2 rounded-[var(--radius-pill)] px-2 disabled:opacity-50"
        >
          <Avatar name={userName} userId={userId} size={30} />
          {isAdmin ? <span className="sr-only">Admin</span> : null}
        </button>
      </div>
      <div className="scroll-edge h-4" aria-hidden="true" />
    </header>
  );
}

function GearIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 2.8v2.1M12 19.1v2.1M21.2 12h-2.1M4.9 12H2.8M18.5 5.5l-1.5 1.5M7 17l-1.5 1.5M18.5 18.5L17 17M7 7L5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
