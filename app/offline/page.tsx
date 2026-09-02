import { Logo } from '@/components/ui/Logo';

export const metadata = { title: 'Offline · Tasq' };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <Logo size={44} title="Tasq" className="mb-5 text-[var(--text-tertiary)]" />
      <h1 className="type-display">No connection</h1>
      <p className="type-body mt-3 text-[var(--text-secondary)]">
        The board needs to reach the shop Mac. If you&apos;re at the shop, the local network is
        enough — off-site you need internet.
      </p>
      <p className="type-callout mt-6 text-[var(--text-tertiary)]">
        This page will get out of the way as soon as the connection is back.
      </p>
    </main>
  );
}
