/**
 * Draws the app icon (a yellow 2x2 brick being set down askew on a red 2x4, on the game's dark
 * background) and writes every file made from it:
 *
 *   client/public/favicon.svg, favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png
 *   desktop/build/icon.png   (electron-builder makes the Windows and Linux icons from it)
 *   icon.png                 (the repository's own icon, for file managers and project lists)
 *
 *     node scripts/app-icon.mjs [path to chromium or chrome]
 *
 * The PNGs are drawn by a headless Chromium, so the shapes come out the same as in a browser.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chromium = process.argv[2] ?? 'chromium';

// ---------- the drawing: isometric bricks in the bricks theme's colours ----------
const UNIT = 52; // pixels per stud
const COS = Math.cos(Math.PI / 6);
const at = (x, y, z) => [256 + (x - y) * COS * UNIT, 250 + (x + y) * 0.5 * UNIT - z * UNIT];
const points = (ps) => ps.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
const n = (v) => v.toFixed(1);

/** A brick of w x d studs and height h, its corner at (x, y, z); colours: top, left, right, stud. */
function brick(x, y, z, w, d, h, c) {
  const top = [at(x, y, z + h), at(x + w, y, z + h), at(x + w, y + d, z + h), at(x, y + d, z + h)];
  const left = [at(x, y + d, z + h), at(x + w, y + d, z + h), at(x + w, y + d, z), at(x, y + d, z)];
  const right = [
    at(x + w, y, z + h),
    at(x + w, y + d, z + h),
    at(x + w, y + d, z),
    at(x + w, y, z),
  ];
  let s = `<polygon points="${points(left)}" fill="${c.left}"/>`;
  s += `<polygon points="${points(right)}" fill="${c.right}"/>`;
  s += `<polygon points="${points(top)}" fill="${c.top}"/>`;
  const studs = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) studs.push([x + i + 0.5, y + j + 0.5]);
  studs.sort((a, b) => a[0] + a[1] - (b[0] + b[1])); // back to front
  const rx = 0.3 * UNIT * COS * Math.SQRT2;
  const ry = rx * 0.577;
  const sh = 0.32 * UNIT;
  for (const [sx, sy] of studs) {
    const [cx, cy] = at(sx, sy, z + h);
    s += `<path d="M${n(cx - rx)},${n(cy)} v${n(-sh)} h${n(2 * rx)} v${n(sh)} a${n(rx)},${n(ry)} 0 0 1 ${n(-2 * rx)},0z" fill="${c.right}"/>`;
    s += `<path d="M${n(cx - rx)},${n(cy - sh)} v${n(sh)} a${n(rx)},${n(ry)} 0 0 0 ${n(rx)},${n(ry)} v${n(-sh)}z" fill="${c.left}"/>`;
    s += `<ellipse cx="${n(cx)}" cy="${n(cy - sh)}" rx="${n(rx)}" ry="${n(ry)}" fill="${c.stud}"/>`;
  }
  return s;
}

const red = { top: '#e5503f', left: '#d8392b', right: '#9b2218', stud: '#ef6a59' };
const yellow = { top: '#ffd43b', left: '#f5c518', right: '#c89d06', stud: '#ffe170' };

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<rect width="512" height="512" rx="112" fill="#1b1d22"/>
<rect x="10" y="10" width="492" height="492" rx="104" fill="none" stroke="#2b2e35" stroke-width="4"/>
<g>${brick(-0.2, -1.2, -1.15, 2, 4, 1.15, red)}</g>
<g transform="rotate(-10 256 200)">${brick(-1, -1.6, 0.55, 2, 2, 1.15, yellow)}</g>
</svg>
`;

// ---------- the files ----------
const pub = join(root, 'client/public');
mkdirSync(pub, { recursive: true });
mkdirSync(join(root, 'desktop/build'), { recursive: true });
writeFileSync(join(pub, 'favicon.svg'), svg);

// A Chromium from snap can only read the home folder, so the page goes there.
const work = mkdtempSync(join(homedir(), 'sar-icon-'));
const sizes = [16, 32, 48, 180, 192, 512];
writeFileSync(join(work, 'icon.svg'), svg);
writeFileSync(
  join(work, 'render.html'),
  `<!doctype html><body><script>
const img = new Image();
img.onload = () => {
  const out = {};
  for (const s of ${JSON.stringify(sizes)}) {
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, s, s);
    out[s] = c.toDataURL('image/png');
  }
  const pre = document.createElement('pre');
  pre.textContent = '@@' + JSON.stringify(out) + '@@';
  document.body.append(pre);
};
img.src = 'icon.svg';
</script></body>`,
);
let dom;
try {
  dom = execFileSync(
    chromium,
    [
      '--headless=new',
      '--disable-gpu',
      '--allow-file-access-from-files',
      '--virtual-time-budget=3000',
      '--dump-dom',
      `file://${join(work, 'render.html')}`,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 },
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
const parts = dom.split('@@');
const png = Object.fromEntries(
  Object.entries(JSON.parse(parts[parts.length - 2])).map(([s, url]) => [
    s,
    Buffer.from(url.split(',')[1], 'base64'),
  ]),
);

writeFileSync(join(pub, 'apple-touch-icon.png'), png[180]);
writeFileSync(join(pub, 'icon-192.png'), png[192]);
writeFileSync(join(pub, 'icon-512.png'), png[512]);
writeFileSync(join(root, 'desktop/build/icon.png'), png[512]);
writeFileSync(join(root, 'icon.png'), png[512]);

// favicon.ico: 16, 32 and 48 pixels, each kept as a PNG inside
const ico = [16, 32, 48];
const head = Buffer.alloc(6 + 16 * ico.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(ico.length, 4);
let offset = head.length;
ico.forEach((s, i) => {
  const e = 6 + 16 * i;
  head[e] = s;
  head[e + 1] = s;
  head.writeUInt16LE(1, e + 4);
  head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(png[s].length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += png[s].length;
});
writeFileSync(join(pub, 'favicon.ico'), Buffer.concat([head, ...ico.map((s) => png[s])]));
console.log(`wrote the icon to ${pub} and desktop/build/icon.png`);
