import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { HistoryList } from '@/components/history/HistoryList';
import { currentUser } from '@/lib/auth/session';
import { isHistoryRange, loadHistory } from '@/lib/history';
import { listAllUsers } from '@/lib/users';
import { localDateString } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; who?: string; q?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  // History is one of exactly two things admin gates.
  if (!user.isAdmin) redirect('/');

  const { range: rawRange, who, q } = await searchParams;
  const range = isHistoryRange(rawRange) ? rawRange : 'week';
  const actorId = who && /^\d+$/.test(who) ? Number(who) : null;
  const text = (q ?? '').trim().slice(0, 100) || undefined;

  const { days, truncated } = loadHistory({ range, actorId, text });

  return (
    <>
      <AppHeader
        userId={user.id}
        userName={user.name}
        isAdmin={user.isAdmin}
        title="History"
        backHref="/settings"
      />
      <HistoryList
        days={days}
        people={listAllUsers().map((u) => ({ id: u.id, name: u.name }))}
        range={range}
        actorId={actorId}
        search={text ?? ''}
        truncated={truncated}
        todayDate={localDateString()}
      />
    </>
  );
}
