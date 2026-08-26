import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  logging: {
    // Next logs every server function call with its arguments in development,
    // which puts PINs in plain text on the terminal — and from there into any
    // pasted log or screen share. Production never logged them, but a dev
    // console is exactly where someone signs in to try something out.
    serverFunctions: false,
  },
  // The repo lives under a parent directory that has its own lockfile; pin the
  // root so Turbopack does not walk up out of the project.
  turbopack: { root: import.meta.dirname },
  // better-sqlite3 is a native addon — it must stay a real require(), not be bundled.
  serverExternalPackages: ['better-sqlite3'],
};

// The board is reached over the Tailscale Funnel hostname and over a bare LAN
// IP, neither of which Next can infer. Only opt into the setting when those
// origins are actually configured, so a plain localhost run stays on defaults.
const extraOrigins = (process.env.TASQ_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (extraOrigins.length > 0) {
  nextConfig.experimental = {
    ...nextConfig.experimental,
    serverActions: { allowedOrigins: extraOrigins },
  };
}

export default nextConfig;
