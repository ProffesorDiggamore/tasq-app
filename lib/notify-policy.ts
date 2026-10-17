import 'server-only';
import { getSetting, setSetting } from '@/lib/settings';
import {
  NOTIFY_EVENTS,
  parseNotifyPolicy,
  type NotifyEventKey,
  type NotifyPolicy,
} from '@/lib/notify-events';

/**
 * Which automatic buzzes this board sends, as the admin left them.
 *
 * One board-wide answer rather than a setting per person: the admin is the one
 * who has to explain a phone going off at 6am, and a crew of five does not want
 * five notification screens to keep in step.
 */
const SETTING_KEY = 'notify.policy';

export async function getNotifyPolicy(): Promise<NotifyPolicy> {
  return parseNotifyPolicy(await getSetting(SETTING_KEY));
}

export async function notifyEnabled(event: NotifyEventKey): Promise<boolean> {
  return (await getNotifyPolicy())[event];
}

/**
 * Writes the whole policy back, defaults included, so what is stored is always
 * a complete answer — reading it later never has to guess whether a missing key
 * meant "off" or "this rule did not exist yet".
 */
export async function setNotifyRule(event: NotifyEventKey, enabled: boolean): Promise<boolean> {
  if (!NOTIFY_EVENTS.some((spec) => spec.key === event)) return false;
  const next = { ...await getNotifyPolicy(), [event]: enabled };
  await setSetting(SETTING_KEY, JSON.stringify(next));
  return true;
}
