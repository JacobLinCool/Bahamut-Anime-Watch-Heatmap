import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const outputDir = resolve("public/icons");
const sizes = [16, 32, 48, 128];

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

const createChunk = (type, data) => {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  let crc = 0xffffffff;
  for (const byte of Buffer.concat([typeBuffer, data])) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
};

const encodePng = (width, height, pixels) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    scanlines[rowStart] = 0;
    pixels.copy(scanlines, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    createChunk("IHDR", header),
    createChunk("IDAT", deflateSync(scanlines)),
    createChunk("IEND", Buffer.alloc(0))
  ]);
};

const hexToRgb = (hex) => {
  const normalized = hex.replace("#", "");
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16)
  ];
};

const blend = (from, to, ratio) => from.map((channel, index) => {
  return Math.round(channel + (to[index] - channel) * ratio);
});

const drawIcon = (size) => {
  const pixels = Buffer.alloc(size * size * 4);
  const backgroundTop = hexToRgb("#0f172a");
  const backgroundBottom = hexToRgb("#075985");
  const inactive = hexToRgb("#e0f2fe");
  const levels = ["#bae6fd", "#7dd3fc", "#38bdf8", "#0ea5e9", "#0369a1"].map(hexToRgb);
  const artwork = Math.round(size * 0.75);
  const artworkOffset = Math.round((size - artwork) / 2);
  const radius = artwork * 0.18;

  const setPixel = (x, y, color, alpha = 255) => {
    const offset = (y * size + x) * 4;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = alpha;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const localX = x - artworkOffset;
      const localY = y - artworkOffset;
      const isOutsideArtwork = localX < 0 || localY < 0 || localX >= artwork || localY >= artwork;
      if (isOutsideArtwork) {
        setPixel(x, y, [0, 0, 0], 0);
        continue;
      }

      const dx = Math.min(localX, artwork - 1 - localX);
      const dy = Math.min(localY, artwork - 1 - localY);
      const outsideCorner = dx < radius && dy < radius
        && (radius - dx) ** 2 + (radius - dy) ** 2 > radius ** 2;

      if (outsideCorner) {
        setPixel(x, y, [0, 0, 0], 0);
        continue;
      }

      setPixel(x, y, blend(backgroundTop, backgroundBottom, localY / Math.max(1, artwork - 1)));
    }
  }

  const margin = Math.max(2, Math.round(artwork * 0.16));
  const gap = Math.max(1, Math.round(artwork * 0.035));
  const cell = Math.floor((artwork - margin * 2 - gap * 5) / 6);
  const startX = artworkOffset + Math.round((artwork - cell * 6 - gap * 5) / 2);
  const startY = artworkOffset + Math.round((artwork - cell * 5 - gap * 4) / 2);

  for (let col = 0; col < 6; col += 1) {
    for (let row = 0; row < 5; row += 1) {
      const value = (col * 3 + row * 5 + size) % 8;
      const color = value < 2 ? inactive : levels[Math.min(levels.length - 1, value - 2)];
      const x0 = startX + col * (cell + gap);
      const y0 = startY + row * (cell + gap);

      for (let y = y0; y < y0 + cell; y += 1) {
        for (let x = x0; x < x0 + cell; x += 1) {
          setPixel(x, y, color);
        }
      }
    }
  }

  return encodePng(size, size, pixels);
};

mkdirSync(outputDir, { recursive: true });

for (const size of sizes) {
  const file = resolve(outputDir, `icon-${size}.png`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, drawIcon(size));
  const digest = createHash("sha256").update(drawIcon(size)).digest("hex").slice(0, 12);
  console.log(`created ${file} ${digest}`);
}
