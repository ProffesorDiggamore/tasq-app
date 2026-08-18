import type { SessionOptions } from 'iron-session';

/**
 * Edge-safe half of the session module. Middleware runs on the edge runtime and
 * must not reach the database, so the cookie shape lives here and everything
 * that touches SQLite stays in session.ts.
 */
export interface SessionData {
  userId?: number;
  /** When this session was last written; drives the rolling refresh in middleware. */
  issuedAt?: number;
}

export const SESSION_COOKIE = 'apex_board_session';
export const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60;
/** Re-issue the cookie once it is a week old so a home-screen icon never expires. */
export const SESSION_REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function sessionOptions(): SessionOptions {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 characters — see .env.example');
  }
  return {
    password,
    cookieName: SESSION_COOKIE,
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
      // Off by default: the LAN fallback runs over plain HTTP (see lib/env.ts).
      secure: process.env.APEX_COOKIE_SECURE === 'true',
    },
  };
}
