import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 is a native addon — it must stay a real require(), not be bundled.
  serverExternalPackages: ['better-sqlite3'],
  // The board is reached over the Tailscale Funnel hostname and over a bare LAN
  // IP. Both are trusted origins for server actions.
  experimental: {
    serverActions: {
      allowedOrigins: (process.env.APEX_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
  },
};

export default nextConfig;
