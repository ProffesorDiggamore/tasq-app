'use client';

import { useCallback, useState, useTransition } from 'react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/Button';
import { PinKeypad } from '@/components/login/PinKeypad';
import { changeOwnPinAction } from '@/app/settings/actions';
import { haptic } from '@/lib/haptics';
import { SPRING_SHEET } from '@/lib/motion';

type Step = 'closed' | 'current' | 'new' | 'confirm' | 'done';

const PROMPT: Record<Exclude<Step, 'closed' | 'done'>, string> = {
  current: 'Enter your current PIN',
  new: 'Pick a new 4-digit PIN',
  confirm: 'Enter the new one again',
};

/**
 * Changing your own PIN, which is a different thing from an admin reset: this
 * one proves you know the current PIN first, so a phone left unlocked on a
 * bench cannot be used to lock its owner out.
 */
export function ChangePinCard() {
  const [step, setStep] = useState<Step>('closed');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorNonce, setErrorNonce] = useState(0);
  const [pending, startTransition] = useTransition();

  const reset = useCallback((to: Step) => {
    setStep(to);
    setCurrentPin('');
    setNewPin('');
    setError(null);
  }, []);

  const failWith = useCallback((message: string, back: Step) => {
    setError(message);
    setErrorNonce((n) => n + 1);
    setStep(back);
    haptic('error');
  }, []);

  const onComplete = useCallback(
    (pin: string) => {
      setError(null);

      if (step === 'current') {
        setCurrentPin(pin);
        setStep('new');
        return;
      }
      if (step === 'new') {
        setNewPin(pin);
        setStep('confirm');
        return;
      }

      startTransition(async () => {
        const result = await changeOwnPinAction(currentPin, newPin, pin);
        if (result.ok) {
          haptic('commit');
          setStep('done');
          setCurrentPin('');
          setNewPin('');
          return;
        }
        // A wrong *current* PIN sends you back to the start; a mismatch on the
        // new one only costs you the last two steps.
        const backToStart = result.message.includes('current PIN') || result.message.includes('Too many');
        if (backToStart) {
          setCurrentPin('');
          setNewPin('');
          failWith(result.message, 'current');
        } else {
          setNewPin('');
          failWith(result.message, 'new');
        }
      });
    },
    [step, currentPin, newPin, failWith],
  );

  return (
    <section>
      <h2 className="type-label px-1 text-[var(--text-tertiary)]">Your PIN</h2>
      {/* Deliberately not an AnimatePresence swap. `mode="wait"` would hold the
          keypad back until the previous step's exit animation finished, which
          makes reaching the next step depend on an animation completing. The
          card animates its own height instead and each step mounts at once. */}
      <motion.div
        layout
        transition={SPRING_SHEET}
        className="material-card mt-2.5 overflow-hidden rounded-[var(--radius-card)] p-4"
      >
        <div>
          {step === 'closed' ? (
            <div>
              <p className="type-callout text-[var(--text-secondary)]">
                Four digits, only you know it. You&apos;ll need the current one to change it.
              </p>
              <Button
                tone="secondary"
                size="md"
                fullWidth
                className="mt-3"
                onPress={() => reset('current')}
              >
                Change my PIN
              </Button>
            </div>
          ) : step === 'done' ? (
            <div>
              <p className="type-headline" style={{ color: 'var(--success)' }}>
                PIN changed
              </p>
              <p className="type-callout mt-1 text-[var(--text-secondary)]">
                Use the new one next time you sign in. Other devices stay signed in.
              </p>
              <Button
                tone="quiet"
                size="md"
                fullWidth
                className="mt-3"
                onPress={() => reset('closed')}
              >
                Done
              </Button>
            </div>
          ) : (
            <div>
              <PinKeypad
                prompt={PROMPT[step]}
                error={error}
                errorNonce={errorNonce}
                disabled={false}
                busy={pending}
                onComplete={onComplete}
              />
              <Button
                tone="plain"
                pill
                className="mt-3 w-full text-[var(--text-secondary)]"
                onPress={() => reset('closed')}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </motion.div>
    </section>
  );
}
