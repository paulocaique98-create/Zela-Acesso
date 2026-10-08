// Gera os ícones PNG do Zela Pass (mesma marca do icon.svg: escudo com check sobre quadrado índigo).
// Sem dependência: rasteriza com supersampling e grava PNG com zlib. Uso: node scripts/gen-reader-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x4f, 0x46, 0xe5];
const FG = [255, 255, 255];

const bez = (p0, p1, p2, p3, n = 24) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return [0, 1].map(
      (k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k],
    );
  });
// contorno do escudo (viewBox 512)
const shield = [
  [256, 104],
  [148, 150],
  [148, 242],
  ...bez([148, 242], [148, 312], [194, 360], [256, 390]).slice(1),
  ...bez([256, 390], [318, 360], [364, 312], [364, 242]).slice(1),
  [364, 150],
  [256, 104],
];
const check = [
  [208, 252],
  [244, 288],
  [308, 216],
];
const segs = (pts) => pts.slice(1).map((p, i) => [pts[i], p]);
const SEGS = [...segs(shield), ...segs(check)];
const HALF = 14;

function dist(px, py, [a, b]) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}
const inRound = (x, y, r) => {
  const cx = Math.min(Math.max(x, r), 512 - r);
  const cy = Math.min(Math.max(y, r), 512 - r);
  return Math.hypot(x - cx, y - cy) <= r;
};

function render(size, { maskable }) {
  const SS = 3;
  const scale = maskable ? 0.66 : 1;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = ((x + (sx + 0.5) / SS) / size) * 512;
          const uy = ((y + (sy + 0.5) / SS) / size) * 512;
          if (maskable || inRound(ux, uy, 112)) bg++;
          // conteúdo centrado e reduzido no maskable (área segura)
          const cx = (ux - 256) / scale + 256;
          const cy = (uy - 256) / scale + 256;
          if (SEGS.some((s) => dist(cx, cy, s) <= HALF)) fg++;
        }
      }
      const n = SS * SS;
      const a = bg / n;
      const f = Math.min(1, fg / n);
      const o = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) px[o + k] = Math.round(BG[k] * (1 - f) + FG[k] * f);
      px[o + 3] = Math.round(255 * a);
    }
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = 'apps/reader/public';
for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]) {
  writeFileSync(`${out}/${name}`, png(size, render(size, { maskable })));
  console.log(`gerado ${out}/${name}`);
}
