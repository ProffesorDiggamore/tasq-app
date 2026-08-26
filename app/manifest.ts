import type { MetadataRoute } from 'next';
import { getOrgName } from '@/lib/settings';

/**
 * Served at /manifest.webmanifest. `standalone` is what removes the browser
 * chrome once the board is on a home screen — and on iOS it is also the
 * precondition for Web Push working at all.
 *
 * The name is the business's own, picked during first-run setup — this route is
 * dynamic so a rename in Settings reaches new home-screen installs.
 */
export const dynamic = 'force-dynamic';

export default function manifest(): MetadataRoute.Manifest {
  const org = getOrgName();
  return {
    name: org,
    short_name: org,
    description: `Tasks and supply requests for ${org}.`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b0b0d',
    theme_color: '#0b0b0d',
    categories: ['productivity', 'business'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'New task', url: '/new' },
      { name: 'Supplies', url: '/supplies' },
    ],
  };
}
