'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import { Segmented } from '@/components/ui/Segmented';
import { CountUp } from '@/components/analytics/CountUp';
import { DeltaChip, StatTile } from '@/components/analytics/StatTile';
import { TrendChart } from '@/components/analytics/TrendChart';
import { usePress } from '@/lib/use-press';
import { haptic } from '@/lib/haptics';
import { SPRING_ENTER } from '@/lib/motion';
import { RANGE_DAYS, type AnalyticsPayload, type RangeKey } from '@/lib/analytics-types';

/**
 * The scoreboard.
 *
 * This screen exists to make a week's work visible to the person who did it.
 * The board is deliberately amnesiac — a finished Tasq clears at 3am and is
 * gone — which is right for a board and wrong for a person, because it means
 * nothing you do ever visibly adds up. So the leading figures here are the
 * ones that accumulate: Tasqs done, bounties collected, days in a row.
 *
 * Two audiences, one screen, decided on the server. A crew member's payload
 * has no `admin` block at all, so everything past "Your work" and the shop's
 * own totals simply is not rendered — and, more to the point, was never sent.
 * See lib/analytics.ts for exactly where that line is drawn.
 *
 * Built phone-first: one column, two-across tiles, a chart sized off its own
 * measured width. The wide layout is the same screen with more room, not a
 * different one.
 */

const RANGE_OPTIONS = [
  { value: 'd7' as const, label: '7 days' },
  { value: 'd30' as const, label: '30 days' },
  { value: 'd90' as const, label: '90 days' },
];

function money(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/** "2h 40m", "3d" — a duration a person reads at a glance, not a precise one. */
function duration(ms: number | null): string {
  if (ms === null) return '—';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Percent change against the window before. Null when there is nothing to compare to. */
function delta(now: number, before: number, goodWhenUp = true) {
  if (before === 0) return null;
  return { pct: Math.round(((now - before) / before) * 100), goodWhenUp };
}

export function AnalyticsScreen({ data }: { data: AnalyticsPayload }) {
  const [range, setRange] = useState<RangeKey>('d30');
  const { personal, shop, admin } = data;

  const days = RANGE_DAYS[range];
  const mySeries = useMemo(() => personal.series.slice(-days), [personal.series, days]);
  const shopSeries = useMemo(() => shop.series.slice(-days), [shop.series, days]);

  const myTotal = personal.done[range];
  const myBefore = range === 'd7' ? personal.done.prev7 : range === 'd30' ? personal.done.prev30 : 0;
  const shopTotal = shop.done[range];
  const shopBefore = range === 'd7' ? shop.done.prev7 : range === 'd30' ? shop.done.prev30 : 0;

  return (
    <main
      className="mx-auto w-full max-w-4xl pb-16"
      style={{ paddingInline: 'var(--gutter)' }}
    >
      {/* The window applies to the whole screen, so it sits above all of it. */}
      <div className="pt-1">
        <Segmented
          options={RANGE_OPTIONS}
          value={range}
          onChange={(next) => {
            haptic('tap');
            setRange(next);
          }}
          label="How far back to look"
        />
      </div>

      <Section title="Your work" delay={0}>
        <div className="grid gap-3 md:grid-cols-[1.6fr_1fr]">
          <motion.section
            layout
            className="material-card rounded-[var(--radius-card)] p-4"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING_ENTER}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="type-headline">Tasqs you finished</h3>
                <p className="type-label mt-0.5 text-[var(--text-tertiary)]">
                  Last {days} days
                </p>
              </div>
              <div className="flex items-baseline gap-2">
                <CountUp
                  value={myTotal}
                  className="type-display tabular"
                  style={{ color: 'var(--accent)' }}
                />
                {(() => {
                  const d = delta(myTotal, myBefore);
                  return d ? <DeltaChip pct={d.pct} goodWhenUp /> : null;
                })()}
              </div>
            </div>
            {/* Keyed on the window so switching redraws the line rather than
                morphing one shape into another that means something else. */}
            <div className="mt-3">
              <TrendChart key={range} series={mySeries} label={`Tasqs you finished, last ${days} days`} />
            </div>
          </motion.section>

          <StreakCard
            streak={personal.streakDays}
            best={personal.bestStreakDays}
            share={personal.sharePct}
          />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile
            index={0}
            label="All time"
            value={personal.done.all}
            tone="accent"
            detail="Every Tasq you have ever marked done on this board, all the way back."
          />
          <StatTile
            index={1}
            label="Collected"
            value={personal.paidCents}
            format={money}
            tone="accent"
            detail="Bounty money you have been paid for finished work. Tasq records it; the cash is handed over in the shop."
          />
          <StatTile
            index={2}
            label="Owed to you"
            value={personal.owedCents}
            format={money}
            detail="Bounties on work you have finished that has not been settled yet."
          />
          <StatTile
            index={3}
            label="ASAP done"
            value={personal.asapDone}
            tone="asap"
            detail={`Urgent Tasqs you finished in the last ${personal.series.length} days.`}
          />
          <StatTile
            index={4}
            label="Grabbed"
            value={personal.claimedFromPool}
            detail="Tasqs you took out of Up for Grabs yourself rather than being handed them."
          />
          <StatTile
            index={5}
            label="On time"
            value={personal.onTimePct ?? 0}
            // Nothing with a due time is not zero percent on time — it is no
            // answer, and a bold 0 next to a caption saying so reads as a fail.
            format={personal.onTimePct === null ? () => '—' : undefined}
            suffix={personal.onTimePct === null ? undefined : '%'}
            detail={
              personal.onTimePct === null
                ? 'None of your Tasqs carried a due time, so there is nothing to be on time for yet.'
                : 'Of your Tasqs that carried a due time, the share you finished before it.'
            }
          />
          <StatTile
            index={6}
            label="Best day"
            value={personal.bestDay?.count ?? 0}
            suffix="in a day"
            detail={
              personal.bestDay
                ? `Your busiest day in this window was ${personal.bestDay.date}.`
                : 'Nothing finished in this window yet.'
            }
          />
          <StatTile
            index={7}
            label="Your share"
            value={personal.sharePct}
            suffix="%"
            detail="Of everything the shop finished in the last 30 days, the part that was yours."
          />
        </div>
      </Section>

      <Section title="The shop" delay={0.08}>
        <motion.section
          layout
          className="material-card rounded-[var(--radius-card)] p-4"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING_ENTER, delay: 0.08 }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="type-headline">Everything finished</h3>
              <p className="type-label mt-0.5 text-[var(--text-tertiary)]">
                {data.isAdmin ? 'Every tab' : 'Your tabs'} · {days} days
              </p>
            </div>
            <div className="flex items-baseline gap-2">
              <CountUp value={shopTotal} className="type-display tabular" />
              {(() => {
                const d = delta(shopTotal, shopBefore);
                return d ? <DeltaChip pct={d.pct} goodWhenUp /> : null;
              })()}
            </div>
          </div>
          <div className="mt-3">
            <TrendChart
              key={`shop-${range}`}
              series={shopSeries}
              label={`Everything the shop finished, last ${days} days`}
            />
          </div>
        </motion.section>

        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile
            index={0}
            label="Open now"
            value={shop.openNow}
            detail="Tasqs on the board right now that nobody has finished."
          />
          <StatTile
            index={1}
            label="Overdue"
            value={shop.overdueNow}
            tone={shop.overdueNow > 0 ? 'asap' : 'default'}
            delta={null}
            detail="Open Tasqs whose due time has already passed."
          />
          <StatTile
            index={2}
            label="On the tools"
            value={shop.activePeople}
            suffix={shop.activePeople === 1 ? 'person' : 'people'}
            detail="People who finished at least one Tasq in the last 30 days."
          />
          <StatTile
            index={3}
            label="All time"
            value={shop.done.all}
            detail="Every Tasq ever finished here that you can see."
          />
        </div>
      </Section>

      {admin ? (
        <>
          <Section title="Money" delay={0.16} note="Only you can see this section.">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile
                index={0}
                label="Outstanding"
                value={admin.outstandingCents}
                format={money}
                tone={admin.outstandingCents > 0 ? 'accent' : 'default'}
                detail={
                  admin.owedPeople === 0
                    ? 'Nobody is owed anything.'
                    : `Owed across ${admin.owedPeople} ${
                        admin.owedPeople === 1 ? 'person' : 'people'
                      }. Settle it on the Payouts screen.`
                }
              />
              <StatTile
                index={1}
                label="Paid out"
                value={admin.paidOutCents}
                format={money}
                detail="Every bounty you have marked paid, lifetime."
              />
              <StatTile
                index={2}
                label="Posted, 30d"
                value={admin.bountiedCents30}
                format={money}
                detail={`Money you put on ${admin.bountiedTasks30} ${
                  admin.bountiedTasks30 === 1 ? 'Tasq' : 'Tasqs'
                } in the last 30 days, whether or not they are done.`}
              />
              <StatTile
                index={3}
                label="Bountied"
                value={admin.bountiedTasks30}
                suffix="in 30d"
                detail="How many Tasqs you attached money to in the last 30 days."
              />
            </div>
          </Section>

          <Section title="The crew" delay={0.22} note="Names and numbers. Crew members see only their own.">
            <ul className="flex flex-col gap-2">
              {admin.crew.map((person, i) => (
                <motion.li
                  key={person.userId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SPRING_ENTER, delay: 0.22 + Math.min(i, 8) * 0.04 }}
                  className="material-card flex items-center gap-3 rounded-[var(--radius-card)] px-4 py-3"
                >
                  <Avatar name={person.name} userId={person.userId} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="type-headline block truncate">{person.name}</span>
                    <span className="type-caption block text-[var(--text-tertiary)]">
                      {person.streakDays > 0
                        ? `${person.streakDays} day${person.streakDays === 1 ? '' : 's'} in a row`
                        : 'No run going'}
                      {person.earnedCents > 0 ? ` · earned ${money(person.earnedCents)}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <CountUp
                      value={person.done30}
                      className="type-headline tabular block"
                      style={{ color: person.done30 > 0 ? 'var(--accent)' : 'var(--text-tertiary)' }}
                    />
                    <span className="type-caption block text-[var(--text-tertiary)]">30d</span>
                  </span>
                </motion.li>
              ))}
            </ul>
          </Section>

          <Section title="How the board is running" delay={0.28}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile
                index={0}
                label="Time to done"
                value={admin.medianCompletionMs === null ? 0 : Math.round(admin.medianCompletionMs / 60000)}
                format={() => duration(admin.medianCompletionMs)}
                detail="Middle time from a Tasq being posted to it being finished, over the last 30 days."
              />
              <StatTile
                index={1}
                label="Time to grab"
                value={admin.medianPickupMs === null ? 0 : Math.round(admin.medianPickupMs / 60000)}
                format={() => duration(admin.medianPickupMs)}
                detail="Middle time an Up for Grabs Tasq waits before somebody claims it."
              />
              <StatTile
                index={2}
                label="Repeats done"
                value={admin.recurringDonePct ?? 0}
                format={admin.recurringDonePct === null ? () => '—' : undefined}
                suffix={admin.recurringDonePct === null ? undefined : '%'}
                detail="Of the Tasqs your repeating rules spawned in the last 30 days, the share that got finished."
              />
              <StatTile
                index={3}
                label="Declined"
                value={admin.declined30}
                suffix="in 30d"
                detail="Tasqs somebody handed back with a reason. Worth a look if it climbs."
              />
              <StatTile
                index={4}
                label="Supplies waiting"
                value={admin.supplies.requested}
                tone={admin.supplies.requested > 0 ? 'asap' : 'default'}
                detail={`${admin.supplies.ordered} on order, ${admin.supplies.received} received all time.`}
              />
              <StatTile
                index={5}
                label="Devices"
                value={admin.devices.approved}
                suffix="approved"
                detail={
                  admin.devices.pending > 0
                    ? `${admin.devices.pending} waiting to be let in.`
                    : 'Nobody is waiting to be let in.'
                }
              />
            </div>
          </Section>
        </>
      ) : (
        <p className="type-caption mt-8 text-center text-[var(--text-tertiary)]">
          Money and crew-wide figures are the owner&rsquo;s to see.
        </p>
      )}
    </main>
  );
}

/** A titled band of the page, arriving a beat after the one above it. */
function Section({
  title,
  note,
  delay,
  children,
}: {
  title: string;
  note?: string;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      className="mt-6"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING_ENTER, delay }}
    >
      {/* On a phone the note goes under the title: side by side it squeezes a
          two-word heading into two lines and still reads as cramped. */}
      <div className="mb-2.5 flex flex-col gap-0.5 px-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <h2 className="type-title">{title}</h2>
        {note ? (
          <span className="type-caption text-[var(--text-tertiary)] sm:text-right">{note}</span>
        ) : null}
      </div>
      {children}
    </motion.section>
  );
}

/**
 * The one card on the screen that is not a measurement — it is a nudge.
 *
 * A run of days is the figure people actually chase, so it gets the loudest
 * treatment on the page: filled with the accent, the number set large, and the
 * flame lit only while the run is live. Tapping it turns the card over to the
 * personal best, which is the only comparison a crew member gets and the only
 * one that is entirely between them and themselves.
 */
function StreakCard({
  streak,
  best,
  share,
}: {
  streak: number;
  best: number;
  share: number;
}) {
  const [flipped, setFlipped] = useState(false);
  const { pressed, handlers } = usePress(() => {
    haptic('tap');
    setFlipped((f) => !f);
  });

  return (
    <motion.button
      type="button"
      layout
      {...handlers}
      data-pressed={pressed ? '' : undefined}
      aria-label={`Streak: ${streak} days. Tap for your best run.`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING_ENTER, delay: 0.06 }}
      className="press-scale relative flex min-h-[168px] flex-col justify-between overflow-hidden rounded-[var(--radius-card)] p-4 text-left"
      style={{
        background: streak > 0 ? 'var(--accent)' : 'var(--surface-strong)',
        color: streak > 0 ? 'var(--accent-ink)' : 'var(--text)',
        border: '1px solid var(--hairline)',
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {flipped ? (
          <motion.span
            key="best"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="flex h-full w-full flex-col justify-between"
          >
            <span className="type-label" style={{ opacity: 0.8 }}>
              Best run
            </span>
            <span>
              <CountUp value={best} className="type-display tabular block" />
              <span className="type-callout block" style={{ opacity: 0.85 }}>
                {best === 1 ? 'day' : 'days'} in a row, your record in the last 90.
              </span>
            </span>
            <span className="type-caption" style={{ opacity: 0.75 }}>
              {share}% of the shop&rsquo;s last 30 days was yours.
            </span>
          </motion.span>
        ) : (
          <motion.span
            key="current"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="flex h-full w-full flex-col justify-between"
          >
            <span className="type-label flex items-center gap-1.5" style={{ opacity: 0.8 }}>
              {streak > 0 ? <Flame /> : null} Streak
            </span>
            <span>
              <CountUp value={streak} className="type-display tabular block" />
              <span className="type-callout block" style={{ opacity: 0.85 }}>
                {streak === 0
                  ? 'Finish one today to start a run.'
                  : `${streak === 1 ? 'day' : 'days'} in a row finishing something.`}
              </span>
            </span>
            <span className="type-caption" style={{ opacity: 0.75 }}>
              Tap for your best run
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

function Flame() {
  return (
    <motion.svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      // A slow, small pulse: alive, and nowhere near a distraction on a wall screen.
      animate={{ scale: [1, 1.12, 1], opacity: [0.85, 1, 0.85] }}
      transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
    >
      <path d="M12 2c.6 3.4-1.2 4.6-2.5 6C8 9.6 7 11 7 13.2 7 17 9.7 20 13 20s5-2.6 5-6c0-3-1.6-5-3-6.4-.3 1.2-1 2-1.9 2.3.6-2.4.3-5.2-1.1-7.9Z" />
    </motion.svg>
  );
}
