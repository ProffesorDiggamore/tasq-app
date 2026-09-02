import 'server-only';
import webpush, { type PushSubscription as WebPushSubscription } from 'web-push';
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { groupMembers, pushSubscriptions, tasks, users } from '@/lib/db/schema';
import type { NotifyIntent } from '@/lib/board-types';
import { getSetting, setSettingIfAbsent } from '@/lib/settings';

/**
 * The single place anything leaves the building.
 *
 * Real SMS costs money per message, so it is out — but every feature calls
 * `notify()` and nothing else, so adding a Twilio adapter later means writing
 * one more `Channel` here and touching no feature code.
 */
interface Channel {
  readonly name: string;
  configured(): boolean;
  send(userIds: number[], intent: NotifyIntent): Promise<void>;
}

/** Used when the deployment does not say otherwise. Push services only need a reachable contact shape. */
const DEFAULT_VAPID_SUBJECT = 'mailto:board-notifications@localhost';

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
function resolveVapidKeys(): VapidKeys | null {
  const envPublic = process.env.VAPID_PUBLIC_KEY;
  const envPrivate = process.env.VAPID_PRIVATE_KEY;
  if (envPublic && envPrivate) return { publicKey: envPublic, privateKey: envPrivate };

  const stored = getSetting('vapid.keys');
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as VapidKeys;
      if (parsed.publicKey && parsed.privateKey) return parsed;
    } catch {
      // Falls through to regeneration below.
    }
  }

  const generated = webpush.generateVAPIDKeys();
  const winner = setSettingIfAbsent('vapid.keys', JSON.stringify(generated));
  const keys = JSON.parse(winner) as VapidKeys;
  console.log('[tasq] Generated Web Push (VAPID) keys and saved them to the database.');
  return keys;
}

function resolveSubject(): string {
  return process.env.VAPID_SUBJECT || getSetting('vapid.subject') || DEFAULT_VAPID_SUBJECT;
}

function configureVapid(): boolean {
  if (vapidReady !== null) return vapidReady;
  try {
    const keys = resolveVapidKeys();
    if (!keys) {
      vapidReady = false;
      return false;
    }
    webpush.setVapidDetails(resolveSubject(), keys.publicKey, keys.privateKey);
    vapidReady = true;
  } catch (error) {
    console.error('[tasq] Could not configure Web Push', error);
    vapidReady = false;
  }
  return vapidReady;
}

export function pushConfigured(): boolean {
  return configureVapid();
}

/** Provisioning happens here too, so the browser can subscribe before anything has been sent. */
export function vapidPublicKey(): string | null {
  return resolveVapidKeys()?.publicKey ?? null;
}

const webPushChannel: Channel = {
  name: 'web-push',
  configured: configureVapid,
  async send(userIds, intent) {
    if (userIds.length === 0) return;
    const subs = db
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
          db
            .update(pushSubscriptions)
            .set({ lastSeenAt: Date.now() })
            .where(eq(pushSubscriptions.id, row.id))
            .run();
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          // 404/410 mean the browser threw the subscription away — so do we,
          // otherwise dead endpoints accumulate forever and slow every send.
          if (status === 404 || status === 410) {
            db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id)).run();
          } else {
            console.warn(`[tasq] push to subscription ${row.id} failed (${status ?? 'no status'})`);
          }
        }
      }),
    );
  },
};

const CHANNELS: readonly Channel[] = [webPushChannel];

function resolveAudience(intent: NotifyIntent): number[] {
  switch (intent.audience.kind) {
    case 'user':
      return [intent.audience.userId];
    case 'admins':
      return db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.isAdmin, true), isNull(users.archivedAt)))
        .all()
        .map((u) => u.id);
    case 'group': {
      // A tab is a wall the rest of the shop cannot see over, so an ASAP posted
      // there must not push its title to people who are not on it. Admins are
      // included because every tab is already theirs on the board itself.
      const { groupId, except } = intent.audience;
      const rows = db
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
      const rows = db
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

/** Send one intent. Never throws — a failed notification must not fail the action. */
export async function dispatch(intent: NotifyIntent): Promise<void> {
  try {
    const userIds = resolveAudience(intent);
    if (userIds.length === 0) return;
    for (const channel of CHANNELS) {
      if (!channel.configured()) continue;
      await channel.send(userIds, intent);
    }
  } catch (error) {
    console.error('[tasq] notification dispatch failed', error);
  }
}

export async function dispatchAll(intents: readonly NotifyIntent[]): Promise<void> {
  for (const intent of intents) await dispatch(intent);
}

/** Called by the scheduler once a task has been stamped as overdue-notified. */
export async function notifyOverdue(taskIds: number[]): Promise<void> {
  if (taskIds.length === 0) return;
  const rows = db
    .select({ id: tasks.id, title: tasks.title, assignedTo: tasks.assignedTo })
    .from(tasks)
    .where(inArray(tasks.id, taskIds))
    .all();

  for (const task of rows) {
    if (task.assignedTo === null) continue;
    await dispatch({
      audience: { kind: 'user', userId: task.assignedTo },
      title: 'Overdue',
      body: task.title,
      url: `/?task=${task.id}`,
      tag: `task-${task.id}`,
      urgent: true,
    });
  }
}
