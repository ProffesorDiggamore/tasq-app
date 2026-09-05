import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { GroupsManager, type GroupRow } from '@/components/settings/GroupsManager';
import { PeopleManager, type PersonRow } from '@/components/settings/PeopleManager';
import { RecurrenceList } from '@/components/settings/RecurrenceList';
import { SettingsLinks, type SettingsLink } from '@/components/settings/SettingsLinks';
import { SettingsNav, type SettingsTab } from '@/components/settings/SettingsNav';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { NotificationSettings } from '@/components/settings/NotificationSettings';
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
import { APPEARANCES, THEMES, getAppearance, getThemeKey } from '@/lib/theme';
import pkg from '@/package.json';
import { Logo } from '@/components/ui/Logo';
import { OrgNameCard } from '@/components/settings/OrgNameCard';
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

type SectionKey =
  | 'general'
  | 'account'
  | 'notifications'
  | 'tasqs'
  | 'people'
  | 'tabs'
  | 'money'
  | 'access';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');

  // Everything an admin-only section would need is only queried when that
  // section is the one open, so a crew member's Settings touches almost nothing.
  const owed = user.isAdmin ? outstandingPayouts() : [];
  const owedCents = owed.reduce((sum, p) => sum + p.cents, 0);
  const owedPeople = owed.length;
  const waitingDevices = user.isAdmin ? pendingDeviceCount() : 0;

  const tabs: SettingsTab[] = [
    { key: 'general', label: 'General' },
    { key: 'account', label: 'Your account' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'tasqs', label: 'Tasqs' },
  ];
  if (user.isAdmin) {
    tabs.push(
      { key: 'people', label: 'People' },
      { key: 'tabs', label: 'Tabs' },
      { key: 'money', label: 'Money', badge: owedPeople || undefined },
      { key: 'access', label: 'Access', badge: waitingDevices || undefined },
    );
  }

  const { s } = await searchParams;
  // An unknown or admin-only key from a stale link falls back to General
  // rather than showing a crew member an empty pane.
  const section: SectionKey = (tabs.some((t) => t.key === s) ? s : 'general') as SectionKey;

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

          {section === 'general' ? (
            <SettingsSection
              title="General"
              description="What this board is called, and how it looks to everyone on it."
            >
              <OrgNameCard name={getOrgName()} canEdit={user.isAdmin} />
              {user.isAdmin ? (
                <ThemeCard
                  current={getThemeKey()}
                  appearance={getAppearance()}
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
              ) : null}
              <SettingsLinks
                links={[
                  {
                    // Everyone gets in here. What is behind the door differs —
                    // see lib/analytics.ts, which builds a crew member's
                    // payload without the shop's money or anybody else's
                    // numbers in it at all.
                    href: '/analytics',
                    label: 'Analytics',
                    hint: user.isAdmin
                      ? 'The whole board: your work, the crew, and the money'
                      : 'What you have finished, and how the shop is doing',
                  },
                  {
                    href: '/?tour=1',
                    label: 'Walkthrough',
                    hint: 'A guided tour of the whole board, about a minute',
                  },
                ]}
              />
              <Footer org={getOrgName()} />
            </SettingsSection>
          ) : null}

          {section === 'account' ? (
            <SettingsSection
              title="Your account"
              description={`Signed in as ${user.name}. ${
                user.isAdmin
                  ? 'You run this board — money, people, and access are yours.'
                  : 'Tap your face in the corner to hand the board to someone else.'
              }`}
            >
              <ChangePinCard />
              <InstallCard />
            </SettingsSection>
          ) : null}

          {section === 'notifications' ? (
            <SettingsSection
              title="Notifications"
              description="Manage when and how this device is told something happened."
            >
              <NotificationSettings />
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

          {section === 'tasqs' ? (
            <SettingsSection
              title="Tasqs"
              description="Work that comes back on a schedule, and the things the shop needs ordered."
            >
              <RecurrenceList
                rules={listRecurrences()}
                people={listActiveUsers().map(toPersonSummary)}
                viewerId={user.id}
                canSetReward={user.isAdmin}
              />
              <SettingsLinks
                links={[
                  {
                    href: '/supplies',
                    label: 'Supplies',
                    hint: user.isAdmin
                      ? 'The whole queue, and ask for something'
                      : 'Ask for something, and see yours',
                    badge: user.isAdmin ? outstandingSupplyCount() : undefined,
                  },
                ]}
              />
            </SettingsSection>
          ) : null}

          {section === 'people' && user.isAdmin ? (
            <SettingsSection
              title="People"
              description="Who is on the crew, who runs the board, and whose PIN needs resetting."
            >
              <PeopleManager people={peopleRows(user.id)} />
            </SettingsSection>
          ) : null}

          {section === 'tabs' && user.isAdmin ? (
            <SettingsSection
              title="Tabs"
              description="Give part of the crew their own board. Only you can make one or decide who is on it."
            >
              <GroupsManager
                groups={groupRows()}
                people={listActiveUsers().map(toPersonSummary)}
              />
            </SettingsSection>
          ) : null}

          {section === 'money' && user.isAdmin ? (
            <SettingsSection
              title="Money"
              description="Bounties you have put on tasks, and what is still owed for the ones that got done."
            >
              <div className="material-card rounded-[var(--radius-card)] p-4">
                <span className="type-label text-[var(--text-tertiary)]">Outstanding</span>
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
                    hint: 'Who is owed what, and mark it paid',
                    badge: owedPeople || undefined,
                  },
                ]}
              />
              <p className="type-caption text-[var(--text-tertiary)]">
                Only an admin can put a bounty on a task. Tasq records what is owed — it never
                moves any money.
              </p>
            </SettingsSection>
          ) : null}

          {section === 'access' && user.isAdmin ? (
            <SettingsSection
              title="Access"
              description="Which devices may reach this board at all, and a record of everything that happened on it."
            >
              <SettingsLinks
                links={[
                  {
                    href: '/devices',
                    label: 'Devices',
                    hint: whitelistEnabled()
                      ? waitingDevices === 0
                        ? 'Only approved devices can reach the board'
                        : `${waitingDevices} waiting to be let in`
                      : 'Lock the board to devices you approve',
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
        </div>
      </main>
    </>
  );
}

function peopleRows(viewerId: number): PersonRow[] {
  return listActiveUsers().map((u) => ({
    id: u.id,
    name: u.name,
    isAdmin: u.isAdmin,
    enrolled: u.pinHash !== null,
    isSelf: u.id === viewerId,
    isFounder: u.isFounder,
  }));
}

function groupRows(): GroupRow[] {
  return listGroups().map((g) => ({
    id: g.id,
    name: g.name,
    memberIds: listGroupMemberIds(g.id),
  }));
}

/** The version stamp, kept on General so it is somewhere findable but not everywhere. */
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
