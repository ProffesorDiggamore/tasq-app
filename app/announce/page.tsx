import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { AnnounceForm } from '@/components/announce/AnnounceForm';
import { currentUser } from '@/lib/auth/session';
import { listActiveUsers, toPersonSummary } from '@/lib/users';

export const dynamic = 'force-dynamic';

export default async function AnnouncePage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const people = listActiveUsers()
    .map(toPersonSummary)
    .filter((p) => p.id !== user.id);

  return (
    <>
      <AppHeader
        userId={user.id}
        userName={user.name}
        isAdmin={user.isAdmin}
        title="Announce"
        backHref="/"
      />
      <main className="flex min-h-[100dvh] flex-col pb-16 pt-4">
        <AnnounceForm people={people} />
      </main>
    </>
  );
}
