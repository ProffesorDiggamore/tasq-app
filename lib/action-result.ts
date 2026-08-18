/** Uniform result shape for server actions that mutate. Never throws at the UI. */
export type ActionResult = { ok: true } | { ok: false; message: string };

export const ok: ActionResult = { ok: true };
export function fail(message: string): ActionResult {
  return { ok: false, message };
}
