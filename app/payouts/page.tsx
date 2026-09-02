import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { PayoutsScreen } from '@/components/payouts/PayoutsScreen';
import { currentUser } from '@/lib/auth/session';
import { outstandingPayouts } from '@/lib/payouts';

export const dynamic = 'force-dynamic';

export default async function PayoutsPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  // Who is owed what is the owner's ledger, not the crew's.
  if (!user.isAdmin) redirect('/');

  return (
    <>
      <AppHeader
        userId={user.id}
        userName={user.name}
        isAdmin={user.isAdmin}
        title="Payouts"
        backHref="/settings"
      />
      <PayoutsScreen people={outstandingPayouts()} serverNow={Date.now()} />
    </>
  );
}
