import os from 'node:os';
import { headers } from 'next/headers';
import QRCode from 'qrcode';

/**
 * The QR must never encode localhost: the person scanning is always on a
 * phone, and an admin setting phones up almost always browses from the server
 * Mac itself. When the board was reached on localhost/127.0.0.1, substitute
 * this machine's LAN address — the same one start.command prints.
 */
function lanUrl(): string | null {
  const port = process.env.PORT?.trim() || '4744';
  for (const list of Object.values(os.networkInterfaces())) {
    for (const nic of list ?? []) {
      if (nic.family === 'IPv4' && !nic.internal) return `http://${nic.address}:${port}`;
    }
  }
  return null;
}

/**
 * A new employee should be able to install the board by pointing a camera at
 * this. The URL is whatever the server is actually being reached on, so the QR
 * is right whether you are on the Tailscale hostname or the shop LAN — unless
 * TASQ_PUBLIC_URL pins it, which is what you want when an admin is setting a
 * phone up over the LAN but the phone needs the off-site address.
 */
export async function InstallCard() {
  const head = await headers();
  const configured = process.env.TASQ_PUBLIC_URL?.trim();
  const host = head.get('x-forwarded-host') ?? head.get('host') ?? 'localhost:4744';
  const proto = head.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const reachedLocally = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const url =
    configured && configured.length > 0
      ? configured
      : reachedLocally
        ? (lanUrl() ?? `${proto}://${host}`)
        : `${proto}://${host}`;

  const qr = await QRCode.toString(url, {
    type: 'svg',
    margin: 0,
    errorCorrectionLevel: 'M',
    color: { dark: '#f5f5f7', light: '#00000000' },
  });

  return (
    <section>
      <h2 className="type-label px-1 text-[var(--text-tertiary)]">Get it on a phone</h2>
      <div className="material-card mt-2.5 flex items-center gap-4 rounded-[var(--radius-card)] p-4">
        <div
          className="shrink-0 rounded-[var(--radius-control)] p-2.5"
          style={{ background: 'var(--surface-strong)', width: 112, height: 112 }}
          // The SVG is generated here from a URL we constructed, not from input.
          dangerouslySetInnerHTML={{ __html: qr }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="type-callout text-[var(--text-secondary)]">
            Scan this, then use <strong className="text-[var(--text)]">Add to Home Screen</strong>{' '}
            so it opens full screen and can send notifications.
          </p>
          <p
            className="type-caption mt-2 break-all rounded-[var(--radius-control)] px-2.5 py-1.5"
            style={{ background: 'var(--surface-strong)', fontFamily: 'var(--font-mono)' }}
          >
            {url}
          </p>
        </div>
      </div>
    </section>
  );
}
