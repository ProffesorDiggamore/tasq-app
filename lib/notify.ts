import 'server-only';
import webpush, { type PushSubscription as WebPushSubscription } from 'web-push';
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { groupMembers, pushSubscriptions, tasks, users } from '@/lib/db/schema';
import type { NotifyIntent } from '@/lib/board-types';
import { getSetting, setSettingIfAbsent } from '@/lib/settings';
import { notifyEnabled } from '@/lib/notify-policy';
import { NOTIFY_HEADLINE, notifyBody, taskDetail } from '@/lib/notify-copy';

/**
 * The single place anything leaves the building.
 *
 * Real SMS costs money per message, so it is out — but every feature calls
 * `notify()` and nothing else, so adding a Twilio adapter later means writing
 * one more `Channel` here and touching no feature code.
 */
interface Channel {
  readonly name: string;
  configured(): Promise<boolean>;
  send(userIds: number[], intent: NotifyIntent): Promise<void>;
}

/**
 * Used when the deployment does not say otherwise.
 *
 * Apple's push service does not merely want a "contact shape": it parses the
 * `sub` claim and rejects a mailto whose domain is not a real one. The old
 * default, `mailto:board-notifications@localhost`, made every send to an iPhone
 * fail with 403 BadJwtToken while Chrome/FCM accepted the same JWT happily —
 * which reads as "notifications are broken on iPhone only".
 */
const DEFAULT_VAPID_SUBJECT = 'mailto:notifications@tasq.app';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let vapidReady: boolean | null = null;

/**
 * Keys come from the environment when the deployment set one — that stays the
 * documented override — and otherwise are generated once and kept in the
 * database, so notifications work on a fresh install without anyone editing
 * .env.local. The pair is stored under ONE key as JSON: two servers booting at
 * once must never end up holding a public half from one pair and a private
 * half from another.
 */
async function resolveVapidKeys(): Promise<VapidKeys | null> {
  const envPublic = process.env.VAPID_PUBLIC_KEY;
  const envPrivate = process.env.VAPID_PRIVATE_KEY;
  if (envPublic && envPrivate) return { publicKey: envPublic, privateKey: envPrivate };

  const stored = await getSetting('vapid.keys');
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as VapidKeys;
      if (parsed.publicKey && parsed.privateKey) return parsed;
    } catch {
      // Falls through to regeneration below.
    }
  }

  const generated = webpush.generateVAPIDKeys();
  const winner = await setSettingIfAbsent('vapid.keys', JSON.stringify(generated));
  const keys = JSON.parse(winner) as VapidKeys;
  console.log('[tasq] Generated Web Push (VAPID) keys and saved them to the database.');
  return keys;
}

/**
 * Apple accepts `https://…` or a mailto at a domain with a dot in it, and
 * answers anything else with a 403 that names no cause. A subject that cannot
 * work is worth catching here, where we can say so, rather than once per send.
 */
function usableSubject(subject: string): boolean {
  if (/^https?:\/\/\S+$/.test(subject)) return true;
  const mail = /^mailto:[^@\s]+@([^@\s]+)$/.exec(subject);
  return mail !== null && mail[1].includes('.') && !mail[1].endsWith('.');
}

async function resolveSubject(): Promise<string> {
  const configured = process.env.VAPID_SUBJECT || await getSetting('vapid.subject');
  if (!configured) return DEFAULT_VAPID_SUBJECT;
  if (usableSubject(configured)) return configured;
  console.warn(
    `[tasq] VAPID subject ${configured} is not one Apple will accept — falling back to ${DEFAULT_VAPID_SUBJECT}. Use https://your-domain or mailto:you@your-domain.`,
  );
  return DEFAULT_VAPID_SUBJECT;
}

async function configureVapid(): Promise<boolean> {
  if (vapidReady !== null) return vapidReady;
  try {
    const keys = await resolveVapidKeys();
    if (!keys) {
      vapidReady = false;
      return false;
    }
    webpush.setVapidDetails(await resolveSubject(), keys.publicKey, keys.privateKey);
    vapidReady = true;
  } catch (error) {
    console.error('[tasq] Could not configure Web Push', error);
    vapidReady = false;
  }
  return vapidReady;
}

export async function pushConfigured(): Promise<boolean> {
  return await configureVapid();
}

/** Provisioning happens here too, so the browser can subscribe before anything has been sent. */
export async function vapidPublicKey(): Promise<string | null> {
  return (await resolveVapidKeys())?.publicKey ?? null;
}

const webPushChannel: Channel = {
  name: 'web-push',
  configured: configureVapid,
  async send(userIds, intent) {
    if (userIds.length === 0) return;
    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.userId, userIds))
      .all();
    if (subs.length === 0) return;

    const body = JSON.stringify({
      title: intent.title,
      body: intent.body,
      url: intent.url,
      tag: intent.tag,
      urgent: intent.urgent,
    });

    await Promise.all(
      subs.map(async (row) => {
        const subscription: WebPushSubscription = {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        };
        try {
          await webpush.sendNotification(subscription, body, { TTL: 60 * 60 });
          await db
            .update(pushSubscriptions)
            .set({ lastSeenAt: Date.now() })
            .where(eq(pushSubscriptions.id, row.id))
            .run();
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          // 404/410 mean the browser threw the subscription away — so do we,
          // otherwise dead endpoints accumulate forever and slow every send.
          if (status === 404 || status === 410) {
            await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id)).run();
          } else if (status === 403) {
            // Not a dead endpoint — the push service refused our credentials, so
            // the row is kept and the reason printed. Apple says BadJwtToken for
            // a subject it will not take; both services say VapidPkHashMismatch
            // when the subscription was minted against a different key pair.
            const reason = (error as { body?: string }).body?.trim();
            console.warn(
              `[tasq] push to subscription ${row.id} refused (403)${reason ? `: ${reason}` : ''} — check VAPID_SUBJECT and that this device re-subscribed with the current key.`,
            );
          } else {
            console.warn(`[tasq] push to subscription ${row.id} failed (${status ?? 'no status'})`);
          }
        }
      }),
    );
  },
};

const CHANNELS: readonly Channel[] = [webPushChannel];

async function resolveAudience(intent: NotifyIntent): Promise<number[]> {
  switch (intent.audience.kind) {
    case 'user':
      return [intent.audience.userId];
    case 'admins': {
      const except = intent.audience.except;
      return (await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.isAdmin, true),
            isNull(users.archivedAt),
            // An admin who just tapped the thing does not need telling about it.
            except === undefined ? undefined : ne(users.id, except),
          ),
        )
        .all())
        .map((u) => u.id);
    }
    case 'group': {
      // A tab is a wall the rest of the shop cannot see over, so an ASAP posted
      // there must not push its title to people who are not on it. Admins are
      // included because every tab is already theirs on the board itself.
      const { groupId, except } = intent.audience;
      const rows = await db
        .selectDistinct({ id: users.id })
        .from(users)
        .leftJoin(groupMembers, eq(groupMembers.userId, users.id))
        .where(
          and(
            isNull(users.archivedAt),
            or(eq(groupMembers.groupId, groupId), eq(users.isAdmin, true)),
            except === undefined ? undefined : ne(users.id, except),
          ),
        )
        .all();
      return rows.map((u) => u.id);
    }
    case 'everyone': {
      const except = intent.audience.except;
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(
          except === undefined
            ? isNull(users.archivedAt)
            : and(isNull(users.archivedAt), ne(users.id, except)),
        )
        .all();
      return rows.map((u) => u.id);
    }
  }
}

const NOBODY: ReadonlySet<number> = new Set();

/**
 * Send one intent, skipping anyone in `alreadyTold`, and report who it actually
 * reached. Never throws — a failed notification must not fail the action.
 */
async function send(intent: NotifyIntent, alreadyTold: ReadonlySet<number>): Promise<number[]> {
  try {
    // The board's own rules come first: a switch turned off on the Notifications
    // screen stops the buzz here, once, rather than at ten call sites. Returning
    // nobody is what lets a later intent about the same task still reach them —
    // a person the rules silenced was not told, so they are not a duplicate.
    if (intent.event !== undefined && !await notifyEnabled(intent.event)) return [];
    const userIds = (await resolveAudience(intent)).filter((id) => !alreadyTold.has(id));
    if (userIds.length === 0) return [];
    for (const channel of CHANNELS) {
      if (!await channel.configured()) continue;
      await channel.send(userIds, intent);
    }
    return userIds;
  } catch (error) {
    console.error('[tasq] notification dispatch failed', error);
    return [];
  }
}

export async function dispatch(intent: NotifyIntent): Promise<void> {
  await send(intent, NOBODY);
}

/**
 * Send a batch from one action, at most one buzz per person per subject.
 *
 * One action routinely produces two intents that overlap. Posting an ASAP job
 * and handing it to Chris writes "For you" to Chris and "Something is ASAP" to
 * everyone-but-the-poster, and Chris is in both — two buzzes, two seconds
 * apart, about one job. Every audience carries an `except` for the person who
 * pressed the button, but no call site can reasonably enumerate everyone an
 * earlier intent in its own batch already covered.
 *
 * So the batch enforces it instead, keyed on `tag`, which is already "the
 * subject this is about" (`task-41`). First intent wins, which is the right
 * one: the personal, more specific message is always pushed before the
 * broadcast. Intents with no tag are announcements about nothing in
 * particular and are never deduplicated against each other.
 */
export async function dispatchAll(intents: readonly NotifyIntent[]): Promise<void> {
  const toldAbout = new Map<string, Set<number>>();
  for (const intent of intents) {
    const tag = intent.tag;
    const reached = await send(intent, (tag && toldAbout.get(tag)) || NOBODY);
    if (tag === undefined || reached.length === 0) continue;
    const seen = toldAbout.get(tag) ?? new Set<number>();
    for (const id of reached) seen.add(id);
    toldAbout.set(tag, seen);
  }
}

/** Called by the scheduler once a task has been stamped as overdue-notified. */
export async function notifyOverdue(taskIds: number[]): Promise<void> {
  if (taskIds.length === 0) return;
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      assignedTo: tasks.assignedTo,
      rewardCents: tasks.rewardCents,
      dueAt: tasks.dueAt,
      notes: tasks.notes,
    })
    .from(tasks)
    .where(inArray(tasks.id, taskIds))
    .all();

  for (const task of rows) {
    if (task.assignedTo === null) continue;
    await dispatch({
      audience: { kind: 'user', userId: task.assignedTo },
      title: NOTIFY_HEADLINE['task.overdue'],
      body: notifyBody(task.title, taskDetail(task)),
      url: `/?task=${task.id}`,
      tag: `task-${task.id}`,
      urgent: true,
      event: 'task.overdue',
    });
  }
}
