// Generates PWA icons (no dependencies): a dark tile with three "feed" bars in
// the Phase 1 stream colors. Run: npm run icons
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [9, 9, 11];
const BARS = [
  { color: [124, 58, 237], width: 0.62 }, // AI/ML violet
  { color: [15, 118, 110], width: 0.48 }, // Data Eng teal
  { color: [220, 38, 38], width: 0.34 }, // Outages red
];

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function inRoundRect(x, y, rx, ry, rw, rh, r) {
  if (x < rx || x > rx + rw || y < ry || y > ry + rh) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + rw - r);
  const cy = Math.min(Math.max(y, ry + r), ry + rh - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** `content` is the fraction of the tile used by the artwork (smaller for maskable safe zone). */
function render(size, content) {
  const ss = 4;
  const out = Buffer.alloc(size * size * 4);
  const pad = (1 - content) / 2;
  const barH = content * 0.16;
  const gap = content * 0.11;
  const total = BARS.length * barH + (BARS.length - 1) * gap;
  const top = 0.5 - total / 2;
  const left = pad + content * 0.12;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          let c = BG;
          BARS.forEach((bar, i) => {
            const by = top + i * (barH + gap);
            if (inRoundRect(x, y, left, by, bar.width * content, barH, barH / 2)) c = bar.color;
          });
          acc[0] += c[0];
          acc[1] += c[1];
          acc[2] += c[2];
        }
      }
      const o = (py * size + px) * 4;
      out[o] = Math.round(acc[0] / (ss * ss));
      out[o + 1] = Math.round(acc[1] / (ss * ss));
      out[o + 2] = Math.round(acc[2] / (ss * ss));
      out[o + 3] = 255;
    }
  }
  return png(size, out);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", render(192, 0.86));
writeFileSync("public/icons/icon-512.png", render(512, 0.86));
writeFileSync("public/icons/icon-maskable-512.png", render(512, 0.68));
writeFileSync("public/icons/apple-touch-icon.png", render(180, 0.8));
console.log("icons written to public/icons/");
