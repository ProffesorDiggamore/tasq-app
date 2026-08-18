/**
 * Everything is stored as Unix ms UTC and displayed in shop time. Both shops
 * are in Idaho, so the zone is fixed rather than read from the device — a phone
 * that travels must not renumber the board.
 */
export const SHOP_TIME_ZONE = 'America/Boise';

/** The board clears completed tasks at 3am local, not midnight — closing shifts run late. */
export const BOARD_RESET_HOUR = 3;

const dateParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHOP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const clockParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: SHOP_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "YYYY-MM-DD" in shop time. This is the key the scheduler dedupes on. */
export function localDateString(ts: number = Date.now()): string {
  return dateParts.format(new Date(ts));
}

/** "HH:MM" (24h) in shop time. */
export function localClockString(ts: number = Date.now()): string {
  return clockParts.format(new Date(ts));
}

/** 0 = Sunday … 6 = Saturday, in shop time. */
export function localWeekday(ts: number = Date.now()): number {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: SHOP_TIME_ZONE,
    weekday: 'short',
  }).format(new Date(ts));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

/** Day of month (1-31) in shop time. */
export function localDayOfMonth(ts: number = Date.now()): number {
  return Number(localDateString(ts).slice(8, 10));
}

/**
 * The UTC instant of a given local wall-clock time. Built by measuring the
 * zone's offset at that moment, so it stays correct across DST changes.
 */
export function localWallClockToUtc(
  dateStr: string,
  timeStr: string,
): number {
  const naive = Date.parse(`${dateStr}T${timeStr}:00Z`);
  const offset = zoneOffsetMs(naive);
  // Apply the offset, then re-measure: near a DST boundary the first guess can
  // land on the wrong side of the transition.
  const first = naive - offset;
  const corrected = naive - zoneOffsetMs(first);
  return corrected;
}

function zoneOffsetMs(ts: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SHOP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ts));
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUtc - ts;
}

/** The instant the board last cleared (today's 3am local, or yesterday's if it's still before 3am). */
export function lastBoardResetAt(now: number = Date.now()): number {
  const today = localDateString(now);
  const todayReset = localWallClockToUtc(
    today,
    `${String(BOARD_RESET_HOUR).padStart(2, '0')}:00`,
  );
  if (now >= todayReset) return todayReset;
  const yesterday = localDateString(now - 24 * 60 * 60 * 1000);
  return localWallClockToUtc(
    yesterday,
    `${String(BOARD_RESET_HOUR).padStart(2, '0')}:00`,
  );
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "in 20 min", "2 hours ago" — used on task cards where exact times are noise. */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return 'just now';
  if (abs < hour) return relative.format(Math.round(diff / minute), 'minute');
  if (abs < day) return relative.format(Math.round(diff / hour), 'hour');
  return relative.format(Math.round(diff / day), 'day');
}

const shortDateTime = new Intl.DateTimeFormat('en-US', {
  timeZone: SHOP_TIME_ZONE,
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

const fullDateTime = new Intl.DateTimeFormat('en-US', {
  timeZone: SHOP_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** "Mon 9:00 AM" for due dates inside the week. */
export function formatShort(ts: number): string {
  return shortDateTime.format(new Date(ts));
}

/** "Aug 17, 2026, 9:00 AM" for History and task detail. */
export function formatFull(ts: number): string {
  return fullDateTime.format(new Date(ts));
}
