import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { GroupsManager, type GroupRow } from '@/components/settings/GroupsManager';
import { PeopleManager, type PersonRow } from '@/components/settings/PeopleManager';
import { RecurrenceList } from '@/components/settings/RecurrenceList';
import { SettingsLinks, type SettingsLink } from '@/components/settings/SettingsLinks';
import { SettingsNav, type SettingsTab } from '@/components/settings/SettingsNav';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { NotificationSettings } from '@/components/settings/NotificationSettings';
import { NotifyRules } from '@/components/settings/NotifyRules';
import { ChangePinCard } from '@/components/settings/ChangePinCard';
import { InstallCard } from '@/components/settings/InstallCard';
import { currentUser } from '@/lib/auth/session';
import { listActiveUsers, toPersonSummary } from '@/lib/users';
import { pendingDeviceCount, whitelistEnabled } from '@/lib/devices';
import { listGroupMemberIds, listGroups } from '@/lib/groups';
import { listRecurrences } from '@/lib/recurrences';
import { formatCents, outstandingPayouts } from '@/lib/payouts';
import { outstandingSupplyCount } from '@/lib/supplies';
import { getOrgName } from '@/lib/settings';
import { getNotifyPolicy } from '@/lib/notify-policy';
import { APPEARANCES, THEMES, getAppearance, getThemeKey } from '@/lib/theme';
import pkg from '@/package.json';
import { Logo } from '@/components/ui/Logo';
import { ThemeCard } from '@/components/settings/ThemeCard';

export const dynamic = 'force-dynamic';

/**
 * Settings is one section at a time now, chosen from a nav rather than one
 * scroll of every card the app has.
 *
 * The old page rendered all of it on every visit — people, tabs, repeating
 * rules, payouts, devices — which meant changing the board's name loaded the
 * whole shop. Sections are server-rendered one at a time, so only the section
 * being read costs a query, and the section lives in `?s=` so Back, refresh,
 * and a deep link all land where the reader expects.
 */

type SectionKey = 'account' | 'work' | 'notifications' | 'team' | 'appearance';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');

  // Badges stay visible in the index, so their small aggregate queries run for
  // admins on every settings section. Full people, group and recurrence lists
  // still load only inside the section that renders them.
  const owed = user.isAdmin ? await outstandingPayouts() : [];
  const owedCents = owed.reduce((sum, p) => sum + p.cents, 0);
  const owedPeople = owed.length;
  const waitingDevices = user.isAdmin ? await pendingDeviceCount() : 0;

  const tabs: SettingsTab[] = user.isAdmin
    ? [
        { key: 'account', label: 'My account' },
        { key: 'team', label: 'Team', badge: waitingDevices || undefined },
        { key: 'work', label: 'Tasks & rewards', badge: owedPeople || undefined },
        { key: 'notifications', label: 'Notifications' },
        { key: 'appearance', label: 'Appearance' },
      ]
    : [
        { key: 'account', label: 'My account' },
        { key: 'work', label: 'Work' },
        { key: 'notifications', label: 'Notifications' },
      ];

  const { s } = await searchParams;
  // An unknown or admin-only key from a stale link falls back to My account
  // rather than showing a crew member an empty pane.
  const section: SectionKey = (tabs.some((t) => t.key === s) ? s : 'account') as SectionKey;

  return (
    <>
      <AppHeader
        userId={user.id}
        userName={user.name}
        isAdmin={user.isAdmin}
        title="Settings"
        backHref="/"
      />
      <main
        className="mx-auto w-full max-w-4xl pb-16"
        style={{ paddingInline: 'var(--gutter)' }}
      >
        <div className="flex flex-col gap-5 md:flex-row md:gap-8">
          <SettingsNav tabs={tabs} current={section} />

          {section === 'account' ? (
            <SettingsSection
              title="My account"
              description={`Signed in as ${user.name}. ${
                user.isAdmin
                  ? 'Your sign-in, device install, and view of the board.'
                  : 'Tap your face in the corner to hand the board to someone else.'
              }`}
            >
              <ChangePinCard />
              <InstallCard />
              <SettingsLinks
                links={[
                  {
                    // Everyone can open Analytics, but the server sends crew a
                    // personal DTO without shop money or anybody else's detail.
                    href: '/analytics',
                    label: 'Analytics',
                    hint: user.isAdmin
                      ? 'Your work, the crew, and the board’s totals'
                      : 'Your completions, streaks, and progress',
                  },
                  {
                    href: '/?tour=1',
                    label: 'Walkthrough',
                    hint: 'A quick tour of My Day and the rest of the board',
                  },
                ]}
              />
              <Footer org={getOrgName()} />
            </SettingsSection>
          ) : null}

          {section === 'work' ? (
            <SettingsSection
              title={user.isAdmin ? 'Tasks & rewards' : 'Work'}
              description={
                user.isAdmin
                  ? 'Repeating work, supply requests, and rewards the board is tracking.'
                  : 'Repeating work and the supplies you have asked the shop for.'
              }
            >
              <RecurrenceList
                rules={await listRecurrences()}
                people={(await listActiveUsers()).map(toPersonSummary)}
                viewerId={user.id}
                canSetReward={user.isAdmin}
              />
              <SettingsLinks
                links={[
                  {
                    href: '/supplies',
                    label: 'Supplies',
                    hint: user.isAdmin
                      ? 'Review the queue or request something'
                      : 'Request something and follow your requests',
                    badge: user.isAdmin ? await outstandingSupplyCount() : undefined,
                  },
                ]}
              />

              {user.isAdmin ? (
                <>
                  <div className="material-card rounded-[var(--radius-card)] p-4">
                    <span className="type-label text-[var(--text-tertiary)]">
                      Rewards outstanding
                    </span>
                    <p
                      className="type-display tabular mt-1"
                      style={{ color: owedCents > 0 ? 'var(--accent)' : 'var(--text-tertiary)' }}
                    >
                      {formatCents(owedCents)}
                    </p>
                    <p className="type-callout mt-1 text-[var(--text-secondary)]">
                      {owedPeople === 0
                        ? 'Nobody is owed anything.'
                        : `across ${owedPeople} ${owedPeople === 1 ? 'person' : 'people'}`}
                    </p>
                  </div>
                  <SettingsLinks
                    links={[
                      {
                        href: '/payouts',
                        label: 'Payouts',
                        hint: 'See who is owed what and mark it paid',
                        badge: owedPeople || undefined,
                      },
                    ]}
                  />
                  <p className="type-caption text-[var(--text-tertiary)]">
                    Tasq records rewards and payments. It never moves money.
                  </p>
                </>
              ) : null}
            </SettingsSection>
          ) : null}

          {section === 'notifications' ? (
            <SettingsSection
              title="Notifications"
              description="Manage when and how this device is told something happened."
            >
              <NotificationSettings />
              {user.isAdmin ? <NotifyRules policy={await getNotifyPolicy()} /> : null}
              <SettingsLinks
                links={[
                  {
                    href: '/announce',
                    label: 'Announce',
                    hint: 'Send a push to one person or to everyone',
                  },
                ]}
              />
            </SettingsSection>
          ) : null}

          {section === 'team' && user.isAdmin ? (
            <SettingsSection
              title="Team"
              description="People, their tabs, approved devices, and the board’s activity record."
            >
              <PeopleManager people={await peopleRows(user.id)} />
              <GroupsManager
                groups={await groupRows()}
                people={(await listActiveUsers()).map(toPersonSummary)}
              />
              <SettingsLinks
                links={[
                  {
                    href: '/devices',
                    label: 'Devices',
                    hint: await whitelistEnabled()
                      ? waitingDevices === 0
                        ? 'Only approved devices can reach the board'
                        : `${waitingDevices} waiting to be let in`
                      : 'Choose which devices may reach the board',
                    badge: waitingDevices || undefined,
                  },
                  {
                    href: '/history',
                    label: 'History',
                    hint: 'Everything that happened, by person and by day',
                  },
                ]}
              />
            </SettingsSection>
          ) : null}

          {section === 'appearance' && user.isAdmin ? (
            <SettingsSection
              title="Appearance"
              description="The light or dark mode and accent color everyone sees on this board."
            >
              <ThemeCard
                current={await getThemeKey()}
                appearance={await getAppearance()}
                themes={Object.entries(THEMES).map(([key, t]) => ({
                  key,
                  label: t.label,
                  accent: t.accent,
                  ink: t.ink,
                }))}
                appearances={Object.entries(APPEARANCES).map(([key, a]) => ({
                  key,
                  label: a.label,
                }))}
              />
            </SettingsSection>
          ) : null}
        </div>
      </main>
    </>
  );
}

async function peopleRows(viewerId: number): Promise<PersonRow[]> {
  return (await listActiveUsers()).map((u) => ({
    id: u.id,
    name: u.name,
    isAdmin: u.isAdmin,
    enrolled: u.pinHash !== null,
    isSelf: u.id === viewerId,
    isFounder: u.isFounder,
  }));
}

async function groupRows(): Promise<GroupRow[]> {
  return Promise.all(
    (await listGroups()).map(async (g) => ({
      id: g.id,
      name: g.name,
      memberIds: await listGroupMemberIds(g.id),
    })),
  );
}

/** The version stamp, kept in My account so it is findable but not everywhere. */
function Footer({ org }: { org: string }) {
  return (
    <div
      className="mt-3 flex flex-col items-center gap-2 text-[var(--text-tertiary)]"
      style={{ opacity: 0.6 }}
    >
      <Logo size={22} />
      <p className="type-caption text-center">
        {org} · v{pkg.version}
      </p>
    </div>
  );
}
