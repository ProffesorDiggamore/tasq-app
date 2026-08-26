'use server';

import { dispatch } from '@/lib/notify';
import { requireUser } from '@/lib/auth/session';
import { getUser } from '@/lib/users';
import { logActivity } from '@/lib/activity';
import { fail, ok, type ActionResult } from '@/lib/action-result';
import type { NotifyAudience } from '@/lib/board-types';

const MAX_LENGTH = 280;

/**
 * A manual push: the shop's loudspeaker. Anyone can send one — to everyone or
 * to one person — because the board trusts its people with tasks already.
 *
 * Announcements are ephemeral by design: they land on phones and in History,
 * never on the board itself, so they cannot rot next to real work.
 */
export async function sendAnnouncementAction(
  target: 'everyone' | number,
  text: string,
): Promise<ActionResult> {
  const me = await requireUser();

  const body = text.trim().replace(/\s+/g, ' ');
  if (body.length === 0) return fail('Write something first.');
  if (body.length > MAX_LENGTH) return fail(`Keep it under ${MAX_LENGTH} characters.`);

  let audience: NotifyAudience;
  let summaryTarget: string;

  if (target === 'everyone') {
    audience = { kind: 'everyone', except: me.id };
    summaryTarget = 'everyone';
  } else {
    if (!Number.isInteger(target)) return fail('Pick who this goes to.');
    const person = getUser(target);
    if (!person || person.archivedAt !== null) return fail('That person is no longer on the board.');
    audience = { kind: 'user', userId: person.id };
    summaryTarget = person.name;
  }

  await dispatch({
    audience,
    title: `${me.name} announced`,
    body,
    url: '/',
    tag: `announce-${Date.now()}`,
  });

  logActivity({
    actorId: me.id,
    verb: 'announcement.sent',
    subjectType: 'announcement',
    subjectId: null,
    summary: `${me.name} announced to ${summaryTarget}: “${body}”`,
  });

  return ok;
}
