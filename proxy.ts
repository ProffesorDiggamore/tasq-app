import { NextResponse, type NextRequest } from 'next/server';
import { getIronSession } from 'iron-session';
import {
  SESSION_REFRESH_AFTER_MS,
  SESSION_TTL_SECONDS,
  SESSION_COOKIE,
  type SessionData,
} from '@/lib/auth/session.config';

const PUBLIC_PATHS = ['/login', '/setup'];

/**
 * Device identity, minted here because a Server Component may not set a cookie.
 * This only hands out an opaque random id and remembers it — whether that id
 * is allowed to see anything is decided in lib/devices.ts, which can read the
 * database. Handing one out costs nothing when the whitelist is off, and the
 * alternative (minting it later) would mean the very first page load of every
 * new browser had no identity to check.
 */
const DEVICE_COOKIE = 'tasq_device';
const DEVICE_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

function ensureDeviceCookie(req: NextRequest, res: NextResponse): void {
  if (req.cookies.get(DEVICE_COOKIE)) return;
  res.cookies.set(DEVICE_COOKIE, crypto.randomUUID(), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: DEVICE_TTL_SECONDS,
    secure: process.env.TASQ_COOKIE_SECURE === 'true',
  });
}

/**
 * Paths the security headers should cover but the session gate must not touch:
 *  - /api/* does its own auth and answers 401 as JSON; an HTML login page
 *    would break every fetch on the client.
 *  - /offline and the PWA assets are served by the service worker while the
 *    connection is down, when no round trip to check a session can happen.
 */
const HEADER_ONLY_PATHS = [
  '/api/',
  '/offline',
  '/sw.js',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/favicon.png',
  '/icons/',
];

function isHeaderOnly(pathname: string): boolean {
  return HEADER_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

/**
 * The app is reached over Tailscale Funnel (https), Cloudflare, and a bare LAN
 * IP (http) — none of which Next can infer. HSTS is only sent when the request
 * actually arrived over https; on the LAN address it would be noise at best
 * and a lock-in hazard at worst.
 */
function isHttps(req: NextRequest): boolean {
  if (req.nextUrl.protocol === 'https:') return true;
  return req.headers.get('x-forwarded-proto')?.split(',')[0].trim() === 'https';
}

/**
 * Pragmatic CSP for a self-hosted board:
 *  - 'unsafe-inline' styles: the app styles with style attributes everywhere.
 *  - 'unsafe-inline' scripts: Next's App Router hydration bootstrap is inline
 *    and nonce-less in this deployment; without it every page would break.
 *  - connect-src 'self': the browser only ever talks to the board's own origin
 *    — web-push sending happens server-side, never from the page.
 *  - worker-src 'self': the service worker at /sw.js.
 *  - No upgrade-insecure-requests: it would break the plain-HTTP LAN address.
 *  - 'unsafe-eval' is added in development only: React's dev build and the HMR
 *    runtime use eval() for debugging features. Production never does, so the
 *    shipped board runs without it.
 */
const DEV = process.env.NODE_ENV !== 'production';

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${DEV ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

function withSecurityHeaders(res: NextResponse, https: boolean): NextResponse {
  res.headers.set('Content-Security-Policy', CSP);
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  if (https) {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return res;
}

/**
 * Two jobs, both cheap enough to run before every request: bounce anonymous requests to
 * the picker, and roll the 90-day cookie forward so a phone on the home screen
 * effectively never asks again. The real authorization check happens in the
 * server actions and pages, which can see the database.
 */
export async function proxy(req: NextRequest) {
  const https = isHttps(req);

  // Static assets, the service worker and API routes get the same headers but
  // no session ceremony — they answer for themselves.
  if (isHeaderOnly(req.nextUrl.pathname)) {
    return withSecurityHeaders(NextResponse.next(), https);
  }

  const res = withSecurityHeaders(NextResponse.next(), https);
  ensureDeviceCookie(req, res);
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
      secure: process.env.TASQ_COOKIE_SECURE === 'true',
    },
  });

  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!session.userId && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    // Come back to where they were headed — a notification deep link must survive login.
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    const redirect = withSecurityHeaders(NextResponse.redirect(url), https);
    ensureDeviceCookie(req, redirect);
    return redirect;
  }

  if (session.userId && isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    const redirect = withSecurityHeaders(NextResponse.redirect(url), https);
    ensureDeviceCookie(req, redirect);
    return redirect;
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
    /*
     * Everything except Next internals (which cannot be meaningfully headed up
     * anyway). API routes, the service worker and the offline page run through
     * here too — they get the security headers but skip the session gate.
     */
    '/((?!_next/static|_next/image).*)',
  ],
};
