import type { Metadata, Viewport } from 'next';
import { MotionProvider } from '@/components/ui/MotionProvider';
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';
import { getOrgName } from '@/lib/settings';
import { themeStyle } from '@/lib/theme';
import './globals.css';

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
    icons: {
      icon: [{ url: '/favicon.png', type: 'image/png' }],
      apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
    },
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={themeStyle()}>
        <MotionProvider>{children}</MotionProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
