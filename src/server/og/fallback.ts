import { deflateSync } from 'node:zlib';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

const crc32 = (value: Buffer) => {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 0xff] as number);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Buffer) => {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(data.byteLength);
  const checksum = Buffer.allocUnsafe(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
};

export const createOgFallbackPng = (width = 1200, height = 630) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  const rowBytes = width * 4 + 1;
  const pixels = Buffer.allocUnsafe(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * rowBytes;
    pixels[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      const glow = Math.max(0, 1 - Math.hypot(x - width * 0.82, y - height * 0.18) / 720);
      const band = Math.max(0, 1 - Math.abs(x - y * 1.35 - 210) / 620);
      pixels[offset] = Math.round(8 + glow * 17 + band * 5);
      pixels[offset + 1] = Math.round(13 + glow * 23 + band * 12);
      pixels[offset + 2] = Math.round(25 + glow * 42 + band * 25);
      pixels[offset + 3] = 255;
    }
  }

  return Buffer.concat([
    pngSignature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};
