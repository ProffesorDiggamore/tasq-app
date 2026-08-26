'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/Button';
import { sendAnnouncementAction } from '@/app/announce-actions';
import type { PersonSummary } from '@/lib/auth/results';
import { haptic } from '@/lib/haptics';
import { SPRING_ENTER } from '@/lib/motion';

const MAX_LENGTH = 280;

/**
 * The shop loudspeaker: pick who hears it — everyone or one person — write the
 * message, send. It arrives as a push on their phone and a line in History.
 */
export function AnnounceForm({ people }: { people: PersonSummary[] }) {
  const router = useRouter();
  const [target, setTarget] = useState<'everyone' | number>('everyone');
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  const send = useCallback(() => {
    setMessage(null);
    startTransition(async () => {
      const result = await sendAnnouncementAction(target, text);
      if (result.ok) {
        haptic('commit');
        setSent(true);
        setText('');
        window.setTimeout(() => {
          router.push('/');
          router.refresh();
        }, 900);
      } else {
        haptic('error');
        setMessage(result.message);
      }
    });
  }, [target, text, router]);

  return (
    <div className="mx-auto w-full max-w-2xl" style={{ paddingInline: 'var(--gutter)' }}>
      <h2 className="type-label px-1 text-[var(--text-tertiary)]">To</h2>

      <div className="mt-2 flex flex-wrap gap-2">
        <Chip
          selected={target === 'everyone'}
          label={`Everyone${people.length > 0 ? ` (${people.length})` : ''}`}
          onPress={() => setTarget('everyone')}
        />
        {people.map((p) => (
          <Chip
            key={p.id}
            selected={target === p.id}
            label={p.name}
            onPress={() => setTarget(p.id)}
          >
            <Avatar name={p.name} userId={p.id} size={20} />
          </Chip>
        ))}
      </div>

      <h2 className="type-label mt-7 px-1 text-[var(--text-tertiary)]">Message</h2>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
        rows={4}
        maxLength={MAX_LENGTH}
        placeholder="What does everyone need to know?"
        aria-label="Announcement message"
        className="material-card mt-2 w-full resize-none rounded-[var(--radius-control)] px-3.5 py-3 outline-none"
        style={{ color: 'var(--text)' }}
      />
      <p className="type-caption mt-1 text-right text-[var(--text-tertiary)]">
        {text.length}/{MAX_LENGTH}
      </p>

      {message ? (
        <p
          className="type-callout mt-3 rounded-[var(--radius-control)] px-3.5 py-2.5"
          style={{
            background: 'color-mix(in srgb, var(--danger) 16%, transparent)',
            color: 'var(--danger)',
          }}
          role="alert"
        >
          {message}
        </p>
      ) : null}

      {sent ? (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={SPRING_ENTER}
          className="type-callout mt-3 rounded-[var(--radius-control)] px-3.5 py-2.5"
          style={{
            background: 'color-mix(in srgb, var(--success) 16%, transparent)',
            color: 'var(--success)',
          }}
          role="status"
        >
          Sent — phones are buzzing.
        </motion.p>
      ) : null}

      <Button
        tone="primary"
        size="lg"
        fullWidth
        disabled={pending || sent || text.trim().length === 0}
        onPress={send}
        className="mt-4"
      >
        {pending ? 'Sending…' : sent ? 'Sent' : target === 'everyone' ? 'Notify everyone' : 'Notify them'}
      </Button>

      <p className="type-caption mt-3 text-center text-[var(--text-tertiary)]">
        Arrives as a push notification and in History. It never lands on the board.
      </p>
    </div>
  );
}

function Chip({
  selected,
  label,
  onPress,
  children,
}: {
  selected: boolean;
  label: string;
  onPress: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={selected}
      className="tap-target type-callout flex items-center gap-2 rounded-full px-3.5 disabled:opacity-50"
      style={{
        minHeight: 38,
        background: selected ? 'var(--accent)' : 'var(--surface-strong)',
        color: selected ? 'var(--accent-ink)' : 'var(--text-secondary)',
        border: selected ? '1px solid transparent' : '1px solid var(--hairline)',
        fontWeight: selected ? 600 : 500,
      }}
    >
      {children}
      {label}
    </button>
  );
}
