import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const out = path.join(process.cwd(), 'public', 'icons');
fs.mkdirSync(out, { recursive: true });

// The mark is drawn as strokes rather than text so it never depends on a font
// being installed on whatever machine builds this.
const glyph = (scale) => {
  const c = 256;
  const s = (v) => c + (v - c) * scale;
  return `
    <path d="M${s(168)} ${s(384)} L${s(256)} ${s(146)} L${s(344)} ${s(384)}"
          stroke="#f5f5f7" stroke-width="${46 * scale}" fill="none"
          stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M${s(203)} ${s(300)} H${s(309)}"
          stroke="#ff9f0a" stroke-width="${38 * scale}"
          stroke-linecap="round"/>`;
};

const svg = ({ radius, scale, bleed }) => `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#17171b"/>
      <stop offset="1" stop-color="#0b0b0d"/>
    </linearGradient>
  </defs>
  <rect x="${bleed ? 0 : 8}" y="${bleed ? 0 : 8}"
        width="${bleed ? 512 : 496}" height="${bleed ? 512 : 496}"
        rx="${radius}" fill="url(#bg)"/>
  ${bleed ? '' : `<rect x="8.5" y="8.5" width="495" height="495" rx="${radius}" fill="none" stroke="#ffffff" stroke-opacity="0.10"/>`}
  ${glyph(scale)}
</svg>`;

// Maskable icons get cropped to a circle by the launcher, so the mark shrinks
// into the safe zone and the background bleeds to the very edge.
const standard = Buffer.from(svg({ radius: 112, scale: 1, bleed: false }));
const maskable = Buffer.from(svg({ radius: 0, scale: 0.72, bleed: true }));

const jobs = [
  ['icon-192.png', standard, 192],
  ['icon-512.png', standard, 512],
  ['icon-maskable-192.png', maskable, 192],
  ['icon-maskable-512.png', maskable, 512],
  // iOS ignores the manifest icons for the home screen and uses this one.
  ['apple-touch-icon.png', Buffer.from(svg({ radius: 0, scale: 0.92, bleed: true })), 180],
];

for (const [name, buf, size] of jobs) {
  await sharp(buf).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(out, name));
  console.log('wrote', name, size);
}

// A favicon for the browser tab.
await sharp(standard).resize(48, 48).png().toFile(path.join(process.cwd(), 'public', 'favicon.png'));
console.log('wrote favicon.png');
