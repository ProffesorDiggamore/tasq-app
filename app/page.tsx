import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { Board } from '@/components/board/Board';
import { currentUser } from '@/lib/auth/session';
import { loadBoard } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');

  // Notifications deep-link to /?task=123 so tapping one opens that task.
  const { task } = await searchParams;
  const initialTaskId = task && /^\d+$/.test(task) ? Number(task) : null;

  const now = Date.now();
  const board = loadBoard(user.id, now);

  return (
    <>
      <AppHeader
        userId={user.id}
        userName={user.name}
        isAdmin={user.isAdmin}
        title="Apex Board"
      />
      <Board
        board={board}
        viewer={{ id: user.id, name: user.name, isAdmin: user.isAdmin }}
        serverNow={now}
        initialTaskId={initialTaskId}
      />
    </>
  );
}
