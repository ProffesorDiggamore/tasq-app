import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { DevicesScreen } from '@/components/devices/DevicesScreen';
import { currentUser } from '@/lib/auth/session';
import { listDevices, whitelistEnabled } from '@/lib/devices';

export const dynamic = 'force-dynamic';

export default async function DevicesPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  // Who gets through the front door is the owner's call alone.
  if (!user.isAdmin) redirect('/');

  const { waiting, approved, blocked } = listDevices();

  return (
    <>
      <AppHeader
        userId={user.id}
        userName={user.name}
        isAdmin={user.isAdmin}
        title="Devices"
        backHref="/settings"
      />
      <DevicesScreen
        enabled={whitelistEnabled()}
        waiting={waiting}
        approved={approved}
        blocked={blocked}
        serverNow={Date.now()}
      />
    </>
  );
}
