import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { PeopleManager, type PersonRow } from '@/components/settings/PeopleManager';
import { currentUser } from '@/lib/auth/session';
import { listActiveUsers } from '@/lib/users';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const people: PersonRow[] = user.isAdmin
    ? listActiveUsers().map((u) => ({
        id: u.id,
        name: u.name,
        isAdmin: u.isAdmin,
        enrolled: u.pinHash !== null,
        isSelf: u.id === user.id,
      }))
    : [];

  return (
    <>
      <AppHeader
        userId={user.id}
        userName={user.name}
        isAdmin={user.isAdmin}
        title="Settings"
        backHref="/"
      />
      <main className="mx-auto w-full max-w-2xl px-4 pb-16">
        <section className="material-card rounded-[var(--radius-card)] p-4">
          <h2 className="type-headline">Signed in as {user.name}</h2>
          <p className="type-callout mt-1 text-[var(--text-secondary)]">
            {user.isAdmin
              ? 'You can see Supply Requests and the full History.'
              : 'Tap your face in the corner to hand the board to someone else.'}
          </p>
        </section>

        {user.isAdmin ? (
          <div className="mt-7">
            <PeopleManager people={people} />
          </div>
        ) : null}
      </main>
    </>
  );
}
