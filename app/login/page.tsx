import { redirect } from 'next/navigation';
import { LoginFlow } from '@/components/login/LoginFlow';
import { listActiveUsers, toPersonSummary } from '@/lib/users';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const people = listActiveUsers().map(toPersonSummary);

  // A board with nobody on it has not been activated yet — send whoever found
  // this address straight to first-run setup instead of an empty picker.
  if (people.length === 0) redirect('/setup');

  // Only same-origin paths — a deep link from a notification must not be able to
  // bounce someone off the board after login.
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  return (
    <main className="flex min-h-[100dvh] flex-col justify-center py-12">
      <LoginFlow people={people} next={target} />
    </main>
  );
}
