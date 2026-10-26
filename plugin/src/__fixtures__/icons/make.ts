import path from 'node:path';

import sharp from 'sharp';

const DIR = path.join(__dirname);

async function _writeIcon(
  filename: string,
  fill: { r: number; g: number; b: number; alpha: number }
): Promise<void> {
  const size = 1024;
  const svg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="rgba(${fill.r},${fill.g},${fill.b},${fill.alpha / 255})"/>
      <circle cx="512" cy="512" r="400" fill="rgba(255,140,0,1)"/>
    </svg>`
  );
  const out = path.join(DIR, filename);
  await sharp(svg).png({ compressionLevel: 9 }).toFile(out);
}

async function main(): Promise<void> {
  await _writeIcon('default.png', { r: 0, g: 0, b: 0, alpha: 0 });
  await _writeIcon('halloween.png', { r: 0, g: 0, b: 0, alpha: 128 });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
