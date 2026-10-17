import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { SuppliesScreen } from '@/components/supplies/SuppliesScreen';
import { currentUser } from '@/lib/auth/session';
import { myRequests, supplyQueue } from '@/lib/supplies';

export const dynamic = 'force-dynamic';

export default async function SuppliesPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  // Everyone can ask; only an admin sees the whole queue.
  const queue = user.isAdmin ? await supplyQueue() : null;

  return (
    <>
      <AppHeader
        userId={user.id}
        userName={user.name}
        isAdmin={user.isAdmin}
        title="Supplies"
        backHref="/settings?s=work"
      />
      <SuppliesScreen
        queue={queue}
        mine={await myRequests(user.id)}
        isAdmin={user.isAdmin}
        viewerId={user.id}
        serverNow={Date.now()}
      />
    </>
  );
}
