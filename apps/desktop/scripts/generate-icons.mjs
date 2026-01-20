#!/usr/bin/env node
/**
 * Generate placeholder icons for development.
 * Run: node scripts/generate-icons.mjs
 *
 * For production, replace these with proper designed icons.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'src-tauri', 'icons');

// Ensure icons directory exists
if (!existsSync(iconsDir)) {
  mkdirSync(iconsDir, { recursive: true });
}

// CRC32 implementation for PNG
function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
}

const crcTable = makeCrcTable();

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return crc ^ 0xFFFFFFFF;
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const typeBuffer = Buffer.from(type);
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

/**
 * Creates a minimal valid PNG with a solid color circle
 */
function createPng(width, height, color) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);
  ihdrData.writeUInt8(6, 9);
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);
  const ihdr = createChunk('IHDR', ihdrData);

  const rawData = [];
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 2 - 2;

  for (let y = 0; y < height; y++) {
    rawData.push(0);
    for (let x = 0; x < width; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius) {
        rawData.push(color.r, color.g, color.b, 255);
      } else {
        rawData.push(0, 0, 0, 0);
      }
    }
  }

  const compressed = deflateSync(Buffer.from(rawData), { level: 9 });
  const idat = createChunk('IDAT', compressed);
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

const colors = {
  gray: { r: 156, g: 163, b: 175 },   // #9CA3AF
  green: { r: 34, g: 197, b: 94 },    // #22C55E
  blue: { r: 59, g: 130, b: 246 },    // #3B82F6 (app icon)
};

// Generate tray icons (32x32)
console.log('Generating tray-gray.png (32x32)...');
writeFileSync(join(iconsDir, 'tray-gray.png'), createPng(32, 32, colors.gray));

console.log('Generating tray-green.png (32x32)...');
writeFileSync(join(iconsDir, 'tray-green.png'), createPng(32, 32, colors.green));

// Generate app icons
console.log('Generating 32x32.png...');
writeFileSync(join(iconsDir, '32x32.png'), createPng(32, 32, colors.blue));

console.log('Generating 128x128.png...');
writeFileSync(join(iconsDir, '128x128.png'), createPng(128, 128, colors.blue));

console.log('Generating 128x128@2x.png (256x256)...');
writeFileSync(join(iconsDir, '128x128@2x.png'), createPng(256, 256, colors.blue));

console.log('\nPlaceholder icons generated!');
console.log('Note: For production, replace these with properly designed icons.');
console.log('\nFor .ico and .icns files, use: pnpm tauri icon path/to/source.png');
