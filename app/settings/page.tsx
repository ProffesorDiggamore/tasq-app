import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { PeopleManager, type PersonRow } from '@/components/settings/PeopleManager';
import { RecurrenceList } from '@/components/settings/RecurrenceList';
import { SettingsLinks, type SettingsLink } from '@/components/settings/SettingsLinks';
import { NotificationSettings } from '@/components/settings/NotificationSettings';
import { InstallCard } from '@/components/settings/InstallCard';
import { currentUser } from '@/lib/auth/session';
import { listActiveUsers } from '@/lib/users';
import { listRecurrences } from '@/lib/recurrences';
import { outstandingSupplyCount } from '@/lib/supplies';

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

  const links: SettingsLink[] = [
    {
      href: '/supplies',
      label: 'Supplies',
      hint: user.isAdmin ? 'The whole queue, and ask for something' : 'Ask for something, and see yours',
      badge: user.isAdmin ? outstandingSupplyCount() : undefined,
    },
  ];
  if (user.isAdmin) {
    links.push({
      href: '/history',
      label: 'History',
      hint: 'Everything that happened, by person and by day',
    });
  }

  return (
    <>
      <AppHeader
        userId={user.id}
        userName={user.name}
        isAdmin={user.isAdmin}
        title="Settings"
        backHref="/"
      />
      <main className="mx-auto w-full max-w-2xl pb-16" style={{ paddingInline: 'var(--gutter)' }}>
        <section className="material-card rounded-[var(--radius-card)] p-4">
          <h2 className="type-headline">Signed in as {user.name}</h2>
          <p className="type-callout mt-1 text-[var(--text-secondary)]">
            {user.isAdmin
              ? 'You can see Supply Requests and the full History.'
              : 'Tap your face in the corner to hand the board to someone else.'}
          </p>
        </section>

        <div className="mt-5">
          <SettingsLinks links={links} />
        </div>

        <div className="mt-7">
          <NotificationSettings />
        </div>

        <div className="mt-7">
          <InstallCard />
        </div>

        <div className="mt-7">
          <RecurrenceList rules={listRecurrences()} />
        </div>

        {user.isAdmin ? (
          <div className="mt-7">
            <PeopleManager people={people} />
          </div>
        ) : null}
      </main>
    </>
  );
}
