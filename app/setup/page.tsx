import { redirect } from 'next/navigation';
import { SetupFlow } from '@/components/setup/SetupFlow';
import { hasActiveUsers, canRecover } from '@/lib/setup';

export const dynamic = 'force-dynamic';

/**
 * First-run activation — and, when `npm run recover` minted a code on a live
 * board, the admin-recovery door. With neither, it just sends people along.
 */
export default async function SetupPage() {
  const mode = !hasActiveUsers() ? 'initial' : canRecover() ? 'recovery' : null;
  if (mode === null) redirect('/login');

  return (
    <main className="flex min-h-[100dvh] flex-col justify-center py-12">
      <SetupFlow mode={mode} />
    </main>
  );
}
