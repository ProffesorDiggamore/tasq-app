import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Writes every derived form of the logo:
 *   public/logo.svg        dark ink, for light surfaces and documents
 *   public/logo-white.svg  knockout, for dark surfaces
 *   public/logo-mark.svg   currentColor, for anything that sets its own ink
 *   public/icons/*.png     home-screen and launcher icons
 *   public/favicon.png     browser tab
 *
 * The geometry is read from lib/logo-mark.ts so there is exactly one copy of
 * it in the repo. Re-run with `node scripts/generate-icons.mjs` after editing
 * that file. The in-app <Logo/> imports the same module directly.
 */

const root = process.cwd();
const pub = path.join(root, 'public');
fs.mkdirSync(path.join(pub, 'icons'), { recursive: true });

const source = fs.readFileSync(path.join(root, 'lib', 'logo-mark.ts'), 'utf8');
const viewBox = /LOGO_VIEWBOX = '([^']+)'/.exec(source)?.[1];
const paths = [...source.matchAll(/^\s{2}'(M[^']+)',$/gm)].map((m) => m[1]);
if (!viewBox || paths.length === 0) {
  throw new Error('Could not read the mark out of lib/logo-mark.ts — did its shape change?');
}

const DARK = '#141414';
/** The app's own near-black, so an icon ground matches the shell behind it. */
const GROUND = '#0b0b0d';

/** The mark alone, no ground, sized to a square box. */
const markSvg = (fill) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="${viewBox}" fill="${fill}">\n` +
  paths.map((d) => `  <path d="${d}"/>`).join('\n') +
  '\n</svg>\n';

const files = [
  ['logo.svg', markSvg(DARK)],
  ['logo-white.svg', markSvg('#ffffff')],
  ['logo-mark.svg', markSvg('currentColor')],
];
for (const [name, svg] of files) {
  fs.writeFileSync(path.join(pub, name), svg);
  console.log('wrote', name);
}

/**
 * Icons need a ground — a transparent launcher icon reads as a hole. The app
 * ships dark-first, so the ground is the shell's own near-black and the mark
 * is knocked out of it. `bleed` fills to the very edge for maskable and Apple
 * icons; otherwise the ground sits inside a rounded square. `scale` shrinks
 * the mark into the launcher's 80% maskable safe zone.
 */
const icon = ({ radius, scale, bleed }) => `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect x="${bleed ? 0 : 8}" y="${bleed ? 0 : 8}"
        width="${bleed ? 512 : 496}" height="${bleed ? 512 : 496}"
        rx="${radius}" fill="${GROUND}"/>
  <svg x="${(256 - 176 * scale).toFixed(1)}" y="${(256 - 176 * scale).toFixed(1)}"
       width="${(352 * scale).toFixed(1)}" height="${(352 * scale).toFixed(1)}"
       viewBox="${viewBox}" fill="#ffffff">
    ${paths.map((d) => `<path d="${d}"/>`).join('\n    ')}
  </svg>
</svg>`;

const standard = Buffer.from(icon({ radius: 112, scale: 1, bleed: false }));
const maskable = Buffer.from(icon({ radius: 0, scale: 0.72, bleed: true }));

const jobs = [
  ['icon-192.png', standard, 192],
  ['icon-512.png', standard, 512],
  ['icon-maskable-192.png', maskable, 192],
  ['icon-maskable-512.png', maskable, 512],
  // iOS ignores the manifest icons for the home screen and uses this one.
  ['apple-touch-icon.png', Buffer.from(icon({ radius: 0, scale: 0.92, bleed: true })), 180],
];

for (const [name, buf, size] of jobs) {
  await sharp(buf).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(pub, 'icons', name));
  console.log('wrote', name, size);
}

await sharp(standard).resize(64, 64).png().toFile(path.join(pub, 'favicon.png'));
console.log('wrote favicon.png');
