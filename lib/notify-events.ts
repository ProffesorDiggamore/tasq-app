/**
 * Every automatic buzz the board can send, and who hears it.
 *
 * The catalogue lives apart from the sending so the settings screen can list
 * the rules without pulling the push stack into the browser bundle, and so a
 * new event is one entry here rather than a switch statement in three places.
 *
 * Announcements are deliberately absent: someone typed that one by hand and
 * pressed send, so there is nothing to govern.
 */
export type NotifyEventKey =
  | 'task.assigned'
  | 'task.self-assigned'
  | 'task.asap'
  | 'task.accepted'
  | 'task.claimed'
  | 'task.declined'
  | 'task.completed'
  | 'task.overdue'
  | 'supply.requested'
  | 'supply.moved';

export interface NotifyEventSpec {
  key: NotifyEventKey;
  /** What the rule is called on the settings screen. */
  label: string;
  /** Who hears it, in the shop's words — the admin is choosing for everyone. */
  hint: string;
  /** On unless the admin says otherwise. */
  on: boolean;
}

export const NOTIFY_EVENTS: readonly NotifyEventSpec[] = [
  {
    key: 'task.assigned',
    label: 'A tasq is assigned to you',
    hint: 'The person it was handed to',
    on: true,
  },
  {
    key: 'task.self-assigned',
    label: 'You assign a tasq to yourself',
    hint: 'You — a receipt that it landed on your list',
    on: true,
  },
  { key: 'task.asap', label: 'Something goes ASAP', hint: 'Everyone but whoever posted it', on: true },
  { key: 'task.accepted', label: 'Someone accepts a tasq', hint: 'Admins', on: true },
  { key: 'task.claimed', label: 'Someone grabs an open tasq', hint: 'Admins', on: true },
  {
    key: 'task.declined',
    label: 'Someone passes on a tasq',
    hint: 'Whoever gave it to them',
    on: true,
  },
  {
    key: 'task.completed',
    label: 'A tasq is finished',
    hint: 'Admins — says who, what, and what it paid',
    on: true,
  },
  { key: 'task.overdue', label: 'A tasq goes overdue', hint: 'The person it belongs to', on: true },
  { key: 'supply.requested', label: 'Someone asks for a supply', hint: 'Admins', on: true },
  {
    key: 'supply.moved',
    label: 'A supply is ordered or arrives',
    hint: 'Whoever asked for it',
    on: true,
  },
];

export type NotifyPolicy = Record<NotifyEventKey, boolean>;

export const NOTIFY_DEFAULTS: NotifyPolicy = Object.fromEntries(
  NOTIFY_EVENTS.map((event) => [event.key, event.on]),
) as NotifyPolicy;

/**
 * Stored settings are merged onto the defaults rather than trusted whole: a
 * rule added in a later version must arrive switched on for a board that was
 * configured before it existed, and a key nobody recognises is dropped instead
 * of being handed to the sender.
 */
export function parseNotifyPolicy(raw: string | null): NotifyPolicy {
  const policy = { ...NOTIFY_DEFAULTS };
  if (!raw) return policy;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return policy;
  }
  if (typeof stored !== 'object' || stored === null) return policy;
  for (const event of NOTIFY_EVENTS) {
    const value = (stored as Record<string, unknown>)[event.key];
    if (typeof value === 'boolean') policy[event.key] = value;
  }
  return policy;
}
