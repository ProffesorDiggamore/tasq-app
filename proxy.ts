import { NextResponse, type NextRequest } from 'next/server';
import { getIronSession } from 'iron-session';
import {
  SESSION_REFRESH_AFTER_MS,
  SESSION_TTL_SECONDS,
  SESSION_COOKIE,
  type SessionData,
} from '@/lib/auth/session.config';

const PUBLIC_PATHS = ['/login'];

/**
 * Two jobs, both cheap enough to run before every request: bounce anonymous requests to
 * the picker, and roll the 90-day cookie forward so a phone on the home screen
 * effectively never asks again. The real authorization check happens in the
 * server actions and pages, which can see the database.
 */
export async function proxy(req: NextRequest) {
  const res = NextResponse.next();
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) return res;

  const session = await getIronSession<SessionData>(req, res, {
    password,
    cookieName: SESSION_COOKIE,
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
      secure: process.env.APEX_COOKIE_SECURE === 'true',
    },
  });

  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!session.userId && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    // Come back to where they were headed — a notification deep link must survive login.
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  if (session.userId && isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Rolling refresh: re-issue only when the cookie is a week old, so we are not
  // writing a Set-Cookie header on every single request.
  if (session.userId) {
    const age = Date.now() - (session.issuedAt ?? 0);
    if (age > SESSION_REFRESH_AFTER_MS) {
      session.issuedAt = Date.now();
      await session.save();
    }
  }

  return res;
}

export const config = {
  matcher: [
    // Everything except Next internals, the service worker, and static assets.
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|api/health).*)',
  ],
};
