import type { Metadata, Viewport } from 'next';
import { MotionProvider } from '@/components/ui/MotionProvider';
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';
import './globals.css';

export const metadata: Metadata = {
  title: 'Apex Board',
  description: 'Tasks and requests for Apex Rental — Nampa and Caldwell.',
  applicationName: 'Apex Board',
  appleWebApp: {
    capable: true,
    title: 'Apex Board',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false },
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/favicon.png', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

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
      <body>
        <MotionProvider>{children}</MotionProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
