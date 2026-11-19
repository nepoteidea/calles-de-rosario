// Renders the PWA icons (PNG) from a tiny pixel-art description, no image libraries.
// Run: node scripts/icons.ts

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

type RGB = [number, number, number];
const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

/** 16×16 design, scaled up. Maskable icons keep the art inside the central 80 %. */
const ART = [
  '................',
  '......####......',
  '......####......',
  '......#yy#......',
  '----.#yyyy#.----',
  '-----#gggg#-----',
  '-----#yyyy#-----',
  '-=-=-#llll#-=-=-',
  '-----#yyyy#-----',
  '-----#yyyy#-----',
  '----.#gggg#.----',
  '......#yy#......',
  '......####......',
  '......####......',
  '................',
  '................',
];
const COLORS: Record<string, RGB> = {
  '.': hex('#15161b'),
  '#': hex('#3b3c43'),
  '-': hex('#3b3c43'),
  '=': hex('#e9c44a'),
  y: hex('#F6B40E'),
  g: hex('#1d2733'),
  l: hex('#ffd45a'),
};

function crc32(buf: Buffer) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size: number, inset: number) {
  const rows: Buffer[] = [];
  const art = size - inset * 2;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const ax = Math.floor(((x - inset) / art) * 16);
      const ay = Math.floor(((y - inset) / art) * 16);
      const ch = ax >= 0 && ay >= 0 && ax < 16 && ay < 16 ? ART[ay][ax] : '.';
      const [r, g, b] = COLORS[ch];
      row[1 + x * 3] = r;
      row[2 + x * 3] = g;
      row[3 + x * 3] = b;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync('public/icons/icon-192.png', png(192, 0));
writeFileSync('public/icons/icon-512.png', png(512, 0));
writeFileSync('public/icons/maskable-512.png', png(512, 64));
console.log('icons written');
