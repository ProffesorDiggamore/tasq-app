import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <p className="type-label text-[var(--text-tertiary)]">Signed in</p>
      <h1 className="type-display mt-2">{user.name}</h1>
      <p className="type-body mt-3 text-[var(--text-secondary)]">
        The board rows land in the next phase.
      </p>
    </main>
  );
}
