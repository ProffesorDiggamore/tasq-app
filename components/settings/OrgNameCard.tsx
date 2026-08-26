'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { setOrgNameAction } from '@/app/settings/actions';

/** The business name — what the board is called everywhere it introduces itself. */
export function OrgNameCard({ name, canEdit }: { name: string; canEdit: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canEdit) {
    return (
      <section>
        <h2 className="type-label px-1 text-[var(--text-tertiary)]">This board</h2>
        <div className="material-card mt-2.5 rounded-[var(--radius-card)] p-4">
          <p className="type-callout text-[var(--text-secondary)]">
            Belongs to <span className="font-medium text-[var(--text)]">{name}</span>.
          </p>
        </div>
      </section>
    );
  }

  const dirty = value.trim() !== name && value.trim().length >= 2;

  return (
    <section>
      <h2 className="type-label px-1 text-[var(--text-tertiary)]">This board</h2>
      <div className="material-card mt-2.5 rounded-[var(--radius-card)] p-4">
        <label className="type-label block text-[var(--text-tertiary)]" htmlFor="org-name">
          Business or team name
        </label>
        <input
          id="org-name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={60}
          autoComplete="organization"
          className="mt-2 w-full rounded-[var(--radius-control)] px-3.5 py-3 outline-none"
          style={{
            background: 'var(--surface-strong)',
            border: '1px solid var(--hairline)',
            color: 'var(--text)',
          }}
        />
        <p
          className="type-caption mt-2 min-h-4"
          style={{ color: message ? 'var(--danger)' : 'var(--text-tertiary)' }}
          role="status"
        >
          {message ?? 'Shown in the header, on home-screen installs, and in the browser tab.'}
        </p>
        {dirty ? (
          <Button
            tone="primary"
            size="md"
            fullWidth
            disabled={pending}
            className="mt-3"
            onPress={() => {
              startTransition(async () => {
                const result = await setOrgNameAction(value);
                if (result.ok) {
                  setValue(value.trim());
                  setMessage(null);
                  router.refresh();
                } else {
                  setMessage(result.message);
                }
              });
            }}
          >
            {pending ? 'Saving…' : `Rename to “${value.trim()}”`}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
