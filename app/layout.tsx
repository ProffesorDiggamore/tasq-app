import type { Metadata, Viewport } from 'next';
import { MotionProvider } from '@/components/ui/MotionProvider';
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';
import { WaitingRoom } from '@/components/devices/WaitingRoom';
import { deviceGate } from '@/lib/devices';
import { getOrgName } from '@/lib/settings';
import { getAppearance, themeStyle } from '@/lib/theme';
import './globals.css';

/**
 * Resolves the stored appearance to a concrete data-appearance attribute on
 * <html> before first paint, so a pinned light or dark board never flashes the
 * other mode. 'system' (the default) reads prefers-color-scheme, and keeps
 * following the device if the OS flips while the board is open. The stored mode
 * is interpolated by the server; it is always one of three validated literals.
 */
const APPEARANCE_SCRIPT = `(function(){var d=document.documentElement,s=%MODE%;function r(){return s==='light'||s==='dark'?s:window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}d.setAttribute('data-appearance',r());try{window.matchMedia('(prefers-color-scheme: light)').addEventListener('change',function(){if(s==='system')d.setAttribute('data-appearance',r())})}catch(e){}})()`;

/**
 * The business's own name wherever the browser or the OS says who this is.
 * Falls back silently when the database has not been set up yet — including
 * during `next build`, which prerenders metadata before a board exists.
 */
export async function generateMetadata(): Promise<Metadata> {
  let org = 'Board';
  try {
    org = getOrgName();
  } catch {
    // No database yet (build time) — the fallback above stands in.
  }
  return {
    title: { default: org, template: `%s · ${org}` },
    description: `Tasks and supply requests for ${org}.`,
    applicationName: org,
    appleWebApp: {
      capable: true,
      title: org,
      statusBarStyle: 'black-translucent',
    },
    formatDetection: { telephone: false },
    manifest: '/manifest.webmanifest',
    // No `icons` here on purpose. app/icon.png and app/apple-icon.png are
    // Next's file conventions: it emits the <link> tags itself, with a content
    // hash in the URL. A plain /favicon.png never changes URL when the artwork
    // does, and browsers that pin favicons in their own store (Opera, Chrome's
    // tab strip) go on showing the old mark for good. The hash makes a changed
    // icon a different URL, so a stale one is impossible.
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Content runs under the notch and the home indicator; body padding puts the
  // safe-area insets back (see globals.css).
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0d' },
    { media: '(prefers-color-scheme: light)', color: '#f2f2f7' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // No database yet during `next build` prerender — 'system' stands in.
  let appearance: string = 'system';
  try {
    appearance = getAppearance();
  } catch {
    // Build time only.
  }

  /**
   * The device gate lives here rather than on each page because here is the one
   * place every route already passes through — a page added later cannot forget
   * to check. It is a no-op (and touches no table) unless an admin has turned
   * the whitelist on. API routes do not render a layout, so they check for
   * themselves; they already require a session either way.
   */
  let gate: Awaited<ReturnType<typeof deviceGate>> = { status: 'off', label: null };
  try {
    gate = await deviceGate();
  } catch {
    // Build time, or a database that is not up yet: fail open rather than
    // bricking the board. The whitelist is a doorman, not the lock.
  }
  const shutOut = gate.status === 'pending' || gate.status === 'blocked';
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: APPEARANCE_SCRIPT.replace('%MODE%', JSON.stringify(appearance)),
          }}
        />
      </head>
      <body style={themeStyle()}>
        {shutOut ? (
          <WaitingRoom label={gate.label} blocked={gate.status === 'blocked'} />
        ) : (
          <>
            <MotionProvider>{children}</MotionProvider>
            <ServiceWorkerRegistrar />
          </>
        )}
      </body>
    </html>
  );
}
