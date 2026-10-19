const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function pixel(x, y) {
  const distance = Math.hypot(x - 128, y - 128);
  if (distance > 117) return [0, 0, 0, 0];
  if (distance > 114) return [124, 180, 135, 255];
  const light = Math.max(0, 1 - Math.hypot(x - 79, y - 53) / 235);
  let rgb = [141 + light * 80, 206 + light * 42, 162 + light * 56];
  const eye = (cx) => Math.hypot((x - cx) / 6, (y - 112) / 12) <= 1;
  if (eye(92) || eye(164)) rgb = [53, 93, 62];
  const smile = Math.hypot(x - 128, y - 124);
  if (y > 128 && Math.abs(smile - 16) < 2.8) rgb = [53, 93, 62];
  if (Math.hypot((x - 73) / 12, (y - 136) / 6) < 1 || Math.hypot((x - 183) / 12, (y - 136) / 6) < 1) rgb = [208, 202, 157];
  return [...rgb, 255];
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const value = pixel((x + (sx + .5) / 4) * 256 / size, (y + (sy + .5) / 4) * 256 / size);
        value.forEach((v, c) => { sum[c] += v; });
      }
      sum.forEach((value, c) => { raw[y * (size * 4 + 1) + 1 + x * 4 + c] = Math.round(value / 16); });
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const assets = path.join(__dirname, '../assets');
fs.mkdirSync(assets, { recursive: true });
const icon = png(256);
fs.writeFileSync(path.join(assets, 'icon.png'), icon);
fs.writeFileSync(path.join(assets, 'tray.png'), png(32));
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(icon.length, 14); ico.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(assets, 'icon.ico'), Buffer.concat([ico, icon]));
