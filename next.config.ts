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
  // The libsql client carries a native addon for local files; Next already
  // keeps @libsql/client and libsql external by default, so nothing to list.
};

// Netlify is always HTTPS, so login cookies are marked Secure there. Inlined at
// build time so the edge proxy and the server functions agree with nothing
// extra to set in the Netlify UI. Never on the shop Mac, whose plain-HTTP LAN
// address would then drop the cookie.
if (process.env.NETLIFY === 'true') {
  nextConfig.env = { ...nextConfig.env, TASQ_COOKIE_SECURE: 'true' };
}

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
