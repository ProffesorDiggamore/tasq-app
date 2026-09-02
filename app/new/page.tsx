import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { NewTaskForm } from '@/components/board/NewTaskForm';
import { currentUser } from '@/lib/auth/session';
import { canUseGroup, tabsForUser } from '@/lib/groups';
import { listActiveUsers, toPersonSummary } from '@/lib/users';

export const dynamic = 'force-dynamic';

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');

  // Anyone on the board can post work. Money is still the owner's call, so the
  // reward field is admin-only — in the form below and again in the machine.
  const { g } = await searchParams;
  const asked = g && /^\d+$/.test(g) ? Number(g) : null;
  const groupId = asked !== null && canUseGroup(user, asked) ? asked : null;

  const people = listActiveUsers().map(toPersonSummary);

  return (
    <>
      <AppHeader
        userId={user.id}
        userName={user.name}
        isAdmin={user.isAdmin}
        title="New task"
        backHref={groupId === null ? '/' : `/?g=${groupId}`}
      />
      <NewTaskForm
        people={people}
        viewerId={user.id}
        canSetReward={user.isAdmin}
        tabs={tabsForUser(user)}
        initialGroupId={groupId}
      />
    </>
  );
}
