import { z } from 'zod';

/**
 * Push keys are optional so the board still boots on a fresh clone before
 * anyone has generated VAPID keys — notifications simply stay off until they do.
 */
const schema = z.object({
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters — see .env.example'),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  /**
   * The board is reachable over HTTPS (Tailscale Funnel) *and* plain HTTP on the
   * shop LAN when the internet is down. A Secure cookie would break the LAN
   * fallback, so this defaults off and can be turned on for HTTPS-only setups.
   */
  APEX_COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${issues.join('\n')}`);
  }
  cached = parsed.data;
  return cached;
}

export function pushConfigured(): boolean {
  const e = env();
  return Boolean(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY && e.VAPID_SUBJECT);
}
