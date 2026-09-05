import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { AnalyticsScreen } from '@/components/analytics/AnalyticsScreen';
import { currentUser } from '@/lib/auth/session';
import { analyticsFor } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

/**
 * Everyone signed in can open this. What arrives is not the same for everyone:
 * `analyticsFor` builds a crew member's payload without the shop's money, any
 * other person's earnings, or a name-by-name ranking, so the tiering is a
 * property of the response rather than of the markup.
 */
export default async function AnalyticsPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  return (
    <>
      <AppHeader
        userId={user.id}
        userName={user.name}
        isAdmin={user.isAdmin}
        title="Analytics"
        backHref="/settings"
      />
      <AnalyticsScreen data={analyticsFor(user)} />
    </>
  );
}
