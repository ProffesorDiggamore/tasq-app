'use server';

import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { requireAdmin } from '@/lib/auth/session';
import {
  DEVICE_COOKIE,
  forgetDevice,
  renameDevice,
  setDeviceStatus,
  setWhitelistEnabled,
} from '@/lib/devices';
import type { ActionResult } from '@/lib/action-result';

/**
 * Who may reach the board at all is the owner's call, so every one of these
 * goes through requireAdmin — and the whole point of the gate is that an
 * un-approved browser cannot render a page in the first place, so it can never
 * get far enough to call one of these anyway.
 */

function refresh(): void {
  revalidatePath('/devices');
  revalidatePath('/settings');
  revalidatePath('/');
}

export async function approveDeviceAction(deviceId: number): Promise<ActionResult> {
  const admin = await requireAdmin();
  const result = setDeviceStatus(admin, deviceId, 'approved');
  if (result.ok) refresh();
  return result;
}

export async function revokeDeviceAction(deviceId: number): Promise<ActionResult> {
  const admin = await requireAdmin();
  const result = setDeviceStatus(admin, deviceId, 'pending');
  if (result.ok) refresh();
  return result;
}

export async function blockDeviceAction(deviceId: number): Promise<ActionResult> {
  const admin = await requireAdmin();
  const result = setDeviceStatus(admin, deviceId, 'blocked');
  if (result.ok) refresh();
  return result;
}

export async function forgetDeviceAction(deviceId: number): Promise<ActionResult> {
  const admin = await requireAdmin();
  const result = forgetDevice(admin, deviceId);
  if (result.ok) refresh();
  return result;
}

export async function renameDeviceAction(deviceId: number, label: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  const result = renameDevice(admin, deviceId, label);
  if (result.ok) refresh();
  return result;
}

/**
 * Turning the gate on approves the browser it was turned on from, so the owner
 * cannot lock themselves out with one tap — see setWhitelistEnabled.
 */
export async function setWhitelistEnabledAction(enabled: boolean): Promise<ActionResult> {
  const admin = await requireAdmin();
  const token = (await cookies()).get(DEVICE_COOKIE)?.value ?? null;
  const userAgent = (await headers()).get('user-agent');
  const result = setWhitelistEnabled(admin, enabled, token, userAgent);
  if (result.ok) refresh();
  return result;
}
