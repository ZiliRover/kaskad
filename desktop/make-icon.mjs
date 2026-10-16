// Draws the brand mark (.logo in globals.css: lime rounded square with a dark inset square)
// into desktop/icon.ico (installer, shortcut, exe) and desktop/tray.png. No dependencies.
// Run: node desktop/make-icon.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const ACCENT = [0xd7, 0xf7, 0x5b], INK = [0x14, 0x16, 0x1a];

// coverage of a rounded rect at (x, y), supersampled for smooth edges
function inRounded(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const u = size / 18; // the CSS mark is 18px: radius 6, inset 5, inner radius 3
  const SS = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let outer = 0, inner = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const fx = x + (sx + 0.5) / SS, fy = y + (sy + 0.5) / SS;
      if (inRounded(fx, fy, 0, 0, size, size, 6 * u)) {
        outer++;
        if (inRounded(fx, fy, 5 * u, 5 * u, size - 5 * u, size - 5 * u, 3 * u)) inner++;
      }
    }
    const a = outer / (SS * SS), t = outer ? inner / outer : 0;
    const i = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) px[i + c] = Math.round(ACCENT[c] * (1 - t) + INK[c] * t);
    px[i + 3] = Math.round(a * 255);
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function png(size) {
  const raw = draw(size);
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) raw.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ICO with PNG-compressed entries (Vista+)
const sizes = [256, 64, 48, 32, 16];
const images = sizes.map(png);
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(images[i].length, 8); e.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return e;
});
const here = new URL(".", import.meta.url);
writeFileSync(new URL("icon.ico", here), Buffer.concat([head, ...dir, ...images]));
writeFileSync(new URL("icon.png", here), png(512));
writeFileSync(new URL("tray.png", here), png(32));
console.log("desktop/icon.ico, icon.png, tray.png");
