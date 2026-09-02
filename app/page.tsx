import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { Board } from '@/components/board/Board';
import { BoardTabs } from '@/components/board/BoardTabs';
import { BoardTour } from '@/components/tour/BoardTour';
import { currentUser } from '@/lib/auth/session';
import { getBoardTask, loadBoard } from '@/lib/tasks';
import { canUseGroup, getGroup, tabsForUser } from '@/lib/groups';
import { listActiveUsers, toPersonSummary } from '@/lib/users';
import { getOrgName } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string; tour?: string; g?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');

  // Notifications deep-link to /?task=123 so tapping one opens that task.
  const { task, tour, g } = await searchParams;
  const initialTaskId = task && /^\d+$/.test(task) ? Number(task) : null;

  // ?g=<id> picks a tab. A tab that was deleted, or that this person was taken
  // off, falls back to the shared board rather than 404ing them out of the app.
  // With no tab named, a deep-linked task chooses it: a notification about work
  // on Group 1 has to open Group 1, or the sheet would open onto an empty board.
  const asked = g && /^\d+$/.test(g) ? Number(g) : null;
  const wanted =
    asked ?? (initialTaskId === null ? null : (getBoardTask(initialTaskId)?.groupId ?? null));
  const groupId = wanted !== null && canUseGroup(user, wanted) ? wanted : null;

  const now = Date.now();
  const board = loadBoard(user.id, now, groupId);
  const tabs = tabsForUser(user);

  // Auto-start walkthrough for users who haven't completed it yet.
  const shouldAutostartTour = tour === '1' || !user.hasToured;

  return (
    <>
      <AppHeader
        userId={user.id}
        userName={user.name}
        isAdmin={user.isAdmin}
        title={groupId === null ? getOrgName() : (getGroup(groupId)?.name ?? getOrgName())}
      />
      <BoardTabs tabs={tabs} current={groupId} />
      <Board
        board={board}
        people={listActiveUsers().map(toPersonSummary)}
        viewer={{ id: user.id, name: user.name, isAdmin: user.isAdmin }}
        serverNow={now}
        initialTaskId={initialTaskId}
      />
      <BoardTour
        autostart={shouldAutostartTour}
        isAdmin={user.isAdmin}
        firstName={user.name.trim().split(/\s+/)[0]}
      />
    </>
  );
}
