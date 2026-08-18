import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { NewTaskForm } from '@/components/board/NewTaskForm';
import { currentUser } from '@/lib/auth/session';
import { listActiveUsers, toPersonSummary } from '@/lib/users';

export const dynamic = 'force-dynamic';

export default async function NewTaskPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const people = listActiveUsers().map(toPersonSummary);

  return (
    <>
      <AppHeader
        userId={user.id}
        userName={user.name}
        isAdmin={user.isAdmin}
        title="New task"
        backHref="/"
      />
      <NewTaskForm people={people} viewerId={user.id} />
    </>
  );
}
