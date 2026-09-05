'use client';

import { PressableLink } from '@/components/ui/PressableLink';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { motion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import { usePress } from '@/lib/use-press';
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
  // The scroll edge exists to separate floating chrome from content passing
  // under it. At the top of the page nothing is under it, so it should not be
  // there at all — a permanent gradient is just a divider wearing a costume.
  const [overlapping, setOverlapping] = useState(false);

  useEffect(() => {
    const update = () => setOverlapping(window.scrollY > 2);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

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
          <PressableLink
            href={backHref}
            className="tap-target type-callout -ml-2 flex items-center rounded-[var(--radius-pill)] px-3 text-[var(--accent)]"
          >
            Back
          </PressableLink>
        ) : (
          <PressableLink
            href="/settings"
            aria-label="Settings"
            data-tour="settings"
            className="tap-target -ml-2 flex items-center rounded-[var(--radius-pill)] px-2"
          >
            <SettingsIcon />
          </PressableLink>
        )}

        <h1 className="type-headline flex-1 truncate text-center">
          {title}
        </h1>

        <SwitchUserButton
          name={userName}
          userId={userId}
          isAdmin={isAdmin}
          disabled={pending}
          onPress={switchUser}
        />
      </div>
      <motion.div
        className="scroll-edge h-4"
        animate={{ opacity: overlapping ? 1 : 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        aria-hidden="true"
      />
    </header>
  );
}

function SwitchUserButton({
  name,
  userId,
  isAdmin,
  disabled,
  onPress,
}: {
  name: string;
  userId: number;
  isAdmin: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { pressed, handlers } = usePress(onPress, disabled);
  return (
    <button
      type="button"
      {...handlers}
      disabled={disabled}
      data-pressed={pressed ? '' : undefined}
      data-tour="switch-user"
      aria-label={`Switch user — currently ${name}`}
      className="press press-scale tap-target -mr-3 flex h-10 w-10 items-center justify-center gap-2 rounded-full disabled:opacity-50"
    >
      <Avatar name={name} userId={userId} size={30} />
      {isAdmin ? <span className="sr-only">Admin</span> : null}
    </button>
  );
}

/** Sliders rather than a cog: at 22px a cog's teeth collapse into a starburst. */
function SettingsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 7h12M19 7h2M3 17h4M11 17h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="17" cy="7" r="2.4" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="9" cy="17" r="2.4" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
