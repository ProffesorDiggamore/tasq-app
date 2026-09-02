import { Logo } from '@/components/ui/Logo';

/**
 * What an un-approved browser sees instead of the board.
 *
 * Deliberately says nothing about the shop: not the business name, not who is
 * on the crew, not whether the address is even right. Someone who found the
 * link learns only that the door is closed and that a person, not a password,
 * opens it.
 */
export function WaitingRoom({ label, blocked }: { label: string | null; blocked?: boolean }) {
  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <Logo size={44} title="Tasq" className="text-[var(--text-tertiary)]" />
      <h1 className="type-display mt-6">{blocked ? 'No access' : 'Waiting to be let in'}</h1>
      <p className="type-body mt-3 text-[var(--text-secondary)]">
        {blocked
          ? 'This device has been turned away. Ask the owner if that was a mistake.'
          : 'This board only opens for devices the owner has approved. Ask them to let this one in, then reload.'}
      </p>
      {label ? (
        <p className="type-caption mt-6 text-[var(--text-tertiary)]">
          They will see it as <span className="text-[var(--text)]">{label}</span>
        </p>
      ) : null}
    </main>
  );
}
