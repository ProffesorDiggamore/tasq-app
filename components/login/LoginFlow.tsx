'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { SuccessCheck } from '@/components/ui/SuccessCheck';
import { usePress } from '@/lib/use-press';
import { PinKeypad } from '@/components/login/PinKeypad';
import { enrollPinAction, submitPinAction } from '@/app/login/actions';
import type { PersonSummary } from '@/lib/auth/results';
import { formatLockoutClient } from '@/lib/auth/lockout.client';
import { haptic } from '@/lib/haptics';
import { SPRING_MOVE, SPRING_SHEET } from '@/lib/motion';

type Stage = 'enter' | 'set' | 'confirm';

export function LoginFlow({ people, next }: { people: PersonSummary[]; next: string }) {
  const router = useRouter();
  const [person, setPerson] = useState<PersonSummary | null>(null);
  const [stage, setStage] = useState<Stage>('enter');
  const [firstEntry, setFirstEntry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorNonce, setErrorNonce] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [pending, startTransition] = useTransition();

  const fail = useCallback((message: string) => {
    setError(message);
    setErrorNonce((n) => n + 1);
  }, []);

  const select = useCallback((p: PersonSummary) => {
    setPerson(p);
    setStage(p.enrolled ? 'enter' : 'set');
    setFirstEntry('');
    setError(null);
    setLockedUntil(null);
  }, []);

  const back = useCallback(() => {
    setPerson(null);
    setError(null);
    setFirstEntry('');
    setLockedUntil(null);
  }, []);

  // Lockout countdown. Ticks in place rather than reloading, so the message
  // stays honest without the person tapping anything.
  useEffect(() => {
    if (lockedUntil === null) return;
    const tick = () => {
      const remaining = lockedUntil - Date.now();
      if (remaining <= 0) {
        setLockedUntil(null);
        setError(null);
        return;
      }
      setError(`Too many tries. ${formatLockoutClient(remaining)} left.`);
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [lockedUntil]);

  const succeed = useCallback(() => {
    router.replace(next);
    router.refresh();
  }, [router, next]);

  // Hold the checkmark for a beat, then move on. Kept in an effect so leaving
  // the screen early cancels the navigation instead of firing it post-unmount.
  useEffect(() => {
    if (!celebrating) return;
    const id = window.setTimeout(succeed, 950);
    return () => window.clearTimeout(id);
  }, [celebrating, succeed]);

  const handleComplete = useCallback(
    (pin: string) => {
      if (!person) return;
      setError(null);

      if (stage === 'set') {
        setFirstEntry(pin);
        setStage('confirm');
        return;
      }

      startTransition(async () => {
        const result =
          stage === 'confirm'
            ? await enrollPinAction(person.id, firstEntry, pin)
            : await submitPinAction(person.id, pin);

        if (result.ok) {
          haptic('commit');
          // First-time PIN set is a moment worth confirming — hold a checkmark
          // for a beat. A daily sign-in stays instant.
          if (stage === 'confirm') {
            setCelebrating(true);
          } else {
            succeed();
          }
          return;
        }

        switch (result.reason) {
          case 'wrong-pin':
            fail(
              `Wrong PIN — ${result.attemptsRemaining} ${
                result.attemptsRemaining === 1 ? 'try' : 'tries'
              } left`,
            );
            break;
          case 'locked':
            setLockedUntil(Date.now() + result.retryAfterMs);
            setErrorNonce((n) => n + 1);
            break;
          case 'mismatch':
            setStage('set');
            setFirstEntry('');
            fail("Those didn't match. Start again.");
            break;
          case 'bad-format':
            fail('Enter 4 digits.');
            break;
          case 'already-enrolled':
            // Someone enrolled on another device between the picker and here.
            setStage('enter');
            setFirstEntry('');
            fail('A PIN is already set. Enter it instead.');
            break;
          case 'not-enrolled':
            setStage('set');
            setFirstEntry('');
            fail('No PIN yet — pick one now.');
            break;
          case 'unknown-user':
            back();
            break;
        }
      });
    },
    [person, stage, firstEntry, fail, succeed, back],
  );

  const prompt =
    stage === 'set'
      ? 'Pick a 4-digit PIN'
      : stage === 'confirm'
        ? 'Enter it once more'
        : 'Enter your PIN';

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-5">
      <AnimatePresence mode="wait" initial={false}>
        {person === null ? (
          <motion.div
            key="picker"
            className="w-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <div className="flex justify-center text-[var(--text)]">
              <Logo size={52} title="Tasq" />
            </div>
            <h1 className="type-display mt-5 text-center">Who&apos;s here?</h1>
            <p className="type-callout mt-2 text-center text-[var(--text-secondary)]">
              Tap your name to open the board.
            </p>

            <ul className="mt-8 flex w-full flex-col gap-2.5">
              {people.map((p) => (
                <li key={p.id}>
                  <PersonButton onPress={() => select(p)}>
                    {/* Shared element: the PIN screen grows out of this circle, so
                        the panel is anchored to the thing that opened it. */}
                    <motion.span layoutId={`person-avatar-${p.id}`} transition={SPRING_MOVE}>
                      <Avatar name={p.name} userId={p.id} size={44} />
                    </motion.span>
                    <span className="min-w-0 flex-1">
                      <span className="type-headline block truncate">{p.name}</span>
                      <span className="type-caption block text-[var(--text-tertiary)]">
                        {p.enrolled ? 'Enter your PIN' : 'Set up a PIN'}
                      </span>
                    </span>
                    <Chevron />
                  </PersonButton>
                </li>
              ))}
            </ul>
          </motion.div>
        ) : (
          <motion.div
            key="pin"
            className="flex w-full flex-col items-center"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={SPRING_SHEET}
          >
            {celebrating ? (
              <div className="flex flex-col items-center py-10 text-center">
                <SuccessCheck size={84} label="PIN saved" />
                <h1 className="type-title mt-5">{person.name}</h1>
                <p className="type-callout mt-2 text-[var(--text-secondary)]">
                  PIN saved. Opening the board…
                </p>
              </div>
            ) : (
              <>
                <motion.span layoutId={`person-avatar-${person.id}`} transition={SPRING_MOVE}>
                  <Avatar name={person.name} userId={person.id} size={68} />
                </motion.span>
                <h1 className="type-title mt-4">{person.name}</h1>

                <div className="mt-6 w-full">
                  <PinKeypad
                    prompt={prompt}
                    error={error}
                    errorNonce={errorNonce}
                    disabled={lockedUntil !== null}
                    busy={pending}
                    onComplete={handleComplete}
                  />
                </div>

                <div className="mt-5">
                  <Button tone="plain" pill onPress={back} className="text-[var(--text-secondary)]">
                    Not you?
                  </Button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The picker rows are card-sized targets, so they press as one surface. */
function PersonButton({
  onPress,
  children,
}: {
  onPress: () => void;
  children: React.ReactNode;
}) {
  const { pressed, handlers } = usePress(onPress);
  return (
    <button
      type="button"
      {...handlers}
      data-pressed={pressed ? '' : undefined}
      className="material-card press-surface tap-target flex w-full items-center gap-3.5 rounded-[var(--radius-card)] px-4 py-3.5 text-left"
    >
      {children}
    </button>
  );
}

function Chevron() {
  return (
    <svg
      width="8"
      height="14"
      viewBox="0 0 8 14"
      fill="none"
      aria-hidden="true"
      style={{ color: 'var(--text-tertiary)' }}
    >
      <path
        d="M1 1l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
