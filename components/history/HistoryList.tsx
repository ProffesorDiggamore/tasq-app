'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/Button';
import { Rail } from '@/components/ui/Rail';
import { verbTone, type HistoryDay, type HistoryRange } from '@/lib/history-types';
import { SHOP_TIME_ZONE } from '@/lib/time';

const RANGES: ReadonlyArray<{ value: HistoryRange; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'all', label: 'Everything' },
];

const TONE_COLOR: Record<ReturnType<typeof verbTone>, string> = {
  task: 'var(--accent)',
  supply: 'var(--success)',
  people: 'var(--text-tertiary)',
  alert: 'var(--danger)',
};

const timeOfDay = new Intl.DateTimeFormat('en-US', {
  timeZone: SHOP_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
});

const dayHeading = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'long',
  month: 'short',
  day: 'numeric',
});

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const run = (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  run.cancel = () => clearTimeout(t);
  return run;
}

export function HistoryList({
  days,
  people,
  range,
  actorId,
  search,
  truncated,
  todayDate,
}: {
  days: HistoryDay[];
  people: ReadonlyArray<{ id: number; name: string }>;
  range: HistoryRange;
  actorId: number | null;
  search: string;
  truncated: boolean;
  todayDate: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const setFilter = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null) next.delete(key);
      else next.set(key, value);
      router.replace(`/history${next.size > 0 ? `?${next}` : ''}`, { scroll: false });
    },
    [params, router],
  );

  // Debounced: typing scrolls the server query, not every keystroke.
  const setSearch = useCallback(
    debounce((value: string) => {
      setFilter('q', value.trim() === '' ? null : value);
    }, 350),
    [setFilter],
  );

  // Leaving the page with keystrokes still in flight must not fire a
  // router.replace for a screen that is already gone.
  useEffect(() => () => setSearch.cancel(), [setSearch]);

  return (
    <main className="mx-auto w-full max-w-2xl pb-24" style={{ paddingInline: 'var(--gutter)' }}>
      <form
        role="search"
        className="mt-1"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(new FormData(e.currentTarget).get('q')?.toString() ?? '');
        }}
      >
        <input
          name="q"
          type="search"
          defaultValue={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
          aria-label="Search history"
          className="tap-target type-body w-full rounded-[var(--radius-control)] px-3.5 py-2"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--hairline)' }}
        />
      </form>

      <Rail className="mt-2 flex gap-2 pb-1" label="Date range">
        {RANGES.map((r) => (
          <Button
            key={r.value}
            tone={range === r.value ? 'primary' : 'secondary'}
            pill
            aria-pressed={range === r.value}
            onPress={() => setFilter('range', r.value)}
            className="shrink-0"
            style={range === r.value ? undefined : { background: 'var(--surface)' }}
          >
            {r.label}
          </Button>
        ))}
      </Rail>

      <Rail className="mt-2 flex gap-2 pb-1" label="Person">
        <Button
          tone={actorId === null ? 'primary' : 'secondary'}
          pill
          aria-pressed={actorId === null}
          onPress={() => setFilter('who', null)}
          className="shrink-0"
          style={actorId === null ? undefined : { background: 'var(--surface)' }}
        >
          Everyone
        </Button>
        {people.map((p) => (
          <Button
            key={p.id}
            tone={actorId === p.id ? 'primary' : 'secondary'}
            pill
            aria-pressed={actorId === p.id}
            onPress={() => setFilter('who', String(p.id))}
            className="shrink-0"
            style={actorId === p.id ? undefined : { background: 'var(--surface)' }}
          >
            <Avatar name={p.name} userId={p.id} size={22} />
            {p.name}
          </Button>
        ))}
      </Rail>

      {days.length === 0 ? (
        <p className="type-callout mt-8 px-1 text-[var(--text-tertiary)]">
          Nothing happened in that window.
        </p>
      ) : (
        days.map((day) => (
          <section key={day.date} className="mt-7">
            <h2 className="type-label px-1 text-[var(--text-tertiary)]">
              {day.date === todayDate ? 'Today' : dayHeading.format(new Date(`${day.date}T12:00:00Z`))}
            </h2>
            <ul className="mt-2 flex flex-col gap-1.5">
              {day.entries.map((entry) => {
                const tone = TONE_COLOR[verbTone(entry.verb)];
                return (
                  // Deliberately not animated. This is a dense log — up to 500
                  // rows — and content that needs an animation to finish before
                  // it is legible is content that can end up invisible.
                  <li
                    key={entry.id}
                    className="material-card flex items-start gap-3 rounded-[var(--radius-control)] px-3.5 py-2.5"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-2 block h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: tone }}
                    />
                    <p className="type-callout min-w-0 flex-1">{entry.summary}</p>
                    <time
                      className="type-caption tabular shrink-0 text-[var(--text-tertiary)]"
                      dateTime={new Date(entry.createdAt).toISOString()}
                    >
                      {timeOfDay.format(new Date(entry.createdAt))}
                    </time>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {truncated ? (
        <p className="type-caption mt-6 px-1 text-[var(--text-tertiary)]">
          Showing the most recent 500 entries. Narrow the range to see further back.
        </p>
      ) : null}
    </main>
  );
}
