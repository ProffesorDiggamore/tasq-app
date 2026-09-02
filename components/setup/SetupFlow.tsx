'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { PinKeypad } from '@/components/login/PinKeypad';
import { SuccessCheck } from '@/components/ui/SuccessCheck';
import {
  checkSetupCodeAction,
  completeSetupAction,
} from '@/app/setup/actions';
import { haptic } from '@/lib/haptics';
import { SPRING_SHEET } from '@/lib/motion';

type Stage = 'code' | 'details' | 'pin' | 'confirm' | 'done';

/**
 * First-run activation: the one-time code, the business name, the first admin
 * and their PIN. Four short screens; the board is empty until this finishes.
 */
export function SetupFlow({ mode = 'initial' }: { mode?: 'initial' | 'recovery' }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('code');
  const [code, setCode] = useState('');
  const [orgName, setOrgName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorNonce, setErrorNonce] = useState(0);
  const [pending, startTransition] = useTransition();

  const fail = useCallback((message: string) => {
    setError(message);
    setErrorNonce((n) => n + 1);
  }, []);

  const submitCode = useCallback(() => {
    if (code.trim().length < 8) {
      fail('Enter the full code — it looks like ABCD-2345.');
      return;
    }
    startTransition(async () => {
      const good = await checkSetupCodeAction(code);
      if (good) {
        haptic('commit');
        setStage('details');
        setError(null);
      } else {
        fail('That code is not valid or has already been used.');
      }
    });
  }, [code, fail]);

  const submitDetails = useCallback(() => {
    if (adminName.trim().length < 2) {
      fail('Your name needs at least two characters.');
      return;
    }
    setError(null);
    setStage('pin');
  }, [adminName, fail]);

  const handlePinComplete = useCallback(
    (pin: string) => {
      if (stage === 'pin') {
        setFirstPin(pin);
        setError(null);
        setStage('confirm');
        return;
      }

      startTransition(async () => {
        const result = await completeSetupAction(code, orgName, adminName, firstPin, pin);
        if (result.ok) {
          haptic('commit');
          // Signed in server-side. Hold on a checkmark for a beat so it is
          // unmistakable it worked, then drop a new owner onto the board with
          // the guided tour running; a recovering admin already knows the app.
          setStage('done');
          return;
        }
        setStage('pin');
        setFirstPin('');
        fail(result.message);
      });
    },
    [stage, code, orgName, adminName, firstPin, router, fail, mode],
  );

  // The done-stage hold before navigating. Kept in an effect so leaving the
  // screen early cancels it instead of navigating a screen that is gone.
  useEffect(() => {
    if (stage !== 'done') return;
    const id = window.setTimeout(() => {
      router.replace(mode === 'recovery' ? '/settings' : '/?tour=1');
      router.refresh();
    }, 1150);
    return () => window.clearTimeout(id);
  }, [stage, router, mode]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-5">
      <AnimatePresence mode="wait" initial={false}>
        {stage === 'code' ? (
          <motion.section
            key="code"
            className="w-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <div className="flex justify-center text-[var(--text)]">
              <Logo size={52} title="Tasq" />
            </div>
            <h1 className="type-display mt-5 text-center">
              {mode === 'recovery' ? 'Recovery' : 'Welcome'}
            </h1>
            <p className="type-callout mt-2 text-center text-[var(--text-secondary)]">
              {mode === 'recovery'
                ? 'Enter the recovery code to add a new admin.'
                : 'Enter the setup code to claim this board.'}
            </p>

            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitCode();
              }}
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={9}
              placeholder=""
              aria-label="Setup code"
              className="material-card mt-8 w-full rounded-[var(--radius-control)] px-4 py-3.5 text-center text-2xl font-medium tracking-[0.2em] uppercase outline-none"
              style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}
            />

            <ErrorLine error={error} />

            <Button
              tone="primary"
              size="lg"
              fullWidth
              disabled={pending}
              className="mt-5"
              onPress={submitCode}
            >
              {pending ? 'Checking…' : 'Continue'}
            </Button>
          </motion.section>
        ) : stage === 'details' ? (
          <motion.section
            key="details"
            className="w-full"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={SPRING_SHEET}
          >
            <h1 className="type-display text-center">Make it yours</h1>
            <p className="type-callout mt-2 text-center text-[var(--text-secondary)]">
              {mode === 'recovery'
                ? 'Who is the new admin? You become one when this finishes.'
                : 'Name the board, then tell us who you are. You become the first admin.'}
            </p>

            {mode === 'initial' ? (
              <>
                <label className="type-label mt-8 block px-1 text-[var(--text-tertiary)]">
                  Business or team name
                </label>
                <input
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitDetails();
                  }}
                  maxLength={60}
                  autoComplete="organization"
                  placeholder=""
                  aria-label="Business or team name"
                  className="material-card mt-2 w-full rounded-[var(--radius-control)] px-4 py-3.5 text-lg outline-none"
                  style={{ color: 'var(--text)' }}
                />
              </>
            ) : null}

            <label
              className={`${mode === 'initial' ? 'mt-4' : 'mt-8'} type-label block px-1 text-[var(--text-tertiary)]`}
            >
              Your name
            </label>
            <input
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitDetails();
              }}
              maxLength={40}
              autoComplete="name"
              placeholder=""
              aria-label="Your name"
              className="material-card mt-2 w-full rounded-[var(--radius-control)] px-4 py-3.5 text-lg outline-none"
              style={{ color: 'var(--text)' }}
            />

            <ErrorLine error={error} />

            <div className="mt-5 flex flex-col gap-2.5">
              <Button
                tone="primary"
                size="lg"
                fullWidth
                onPress={submitDetails}
              >
                Continue
              </Button>
              <Button
                tone="plain"
                size="md"
                fullWidth
                onPress={() => {
                  setStage('code');
                  setError(null);
                }}
                className="text-[var(--text-secondary)]"
              >
                Back
              </Button>
            </div>
          </motion.section>
        ) : stage === 'done' ? (
          <motion.section
            key="done"
            className="flex w-full flex-col items-center text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <SuccessCheck size={84} label="Board ready" />
            <h1 className="type-title mt-5">
              {mode === 'recovery' ? "You're an admin now" : `${orgName.trim() || 'Your board'} is ready`}
            </h1>
            <p className="type-callout mt-2 text-[var(--text-secondary)]">
              {mode === 'recovery' ? 'Opening Settings…' : 'Starting a quick tour…'}
            </p>
          </motion.section>
        ) : (
          <motion.section
            key="pin"
            className="flex w-full flex-col items-center"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={SPRING_SHEET}
          >
            <h1 className="type-title mt-4 text-center">
              {stage === 'pin' ? `Hi, ${adminName.trim()}` : 'Once more'}
            </h1>

            <div className="mt-6 w-full">
              <PinKeypad
                prompt={
                  stage === 'pin'
                    ? 'Pick a 4-digit PIN — you will sign in with it from now on'
                    : 'Enter it once more'
                }
                error={error}
                errorNonce={errorNonce}
                disabled={false}
                busy={pending}
                onComplete={handlePinComplete}
              />
            </div>

            <div className="mt-5">
              <Button
                tone="plain"
                pill
                onPress={() => {
                  setFirstPin('');
                  setStage('pin');
                  setError(null);
                }}
                className="text-[var(--text-secondary)]"
              >
                Start PIN over
              </Button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return (
    <p
      className="type-caption mt-3 min-h-5 text-center"
      style={{ color: error ? 'var(--danger)' : 'var(--text-tertiary)' }}
      role="alert"
    >
      {error ?? ''}
    </p>
  );
}
