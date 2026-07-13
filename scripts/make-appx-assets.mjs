// One-time developer helper to generate the AppX/MSIX tile images consumed by
// electron-builder's appx target. electron-builder silently substitutes its
// own generic "SampleAppx.*" placeholder art for any of these files that
// aren't present in build/appx/ - that placeholder art is exactly what
// Microsoft Store certification flags as a "Tile" violation, since it
// doesn't represent this product. Generating brand-consistent tiles (same
// blue background + "W" mark as assets/icon.ico) here, offline, avoids that.
import Jimp from 'jimp';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const BLUE = 0x2563ebff;
const LETTER = 'W';
const APP_NAME = 'PDF Stamp';
const FONT_SIZES = {
  32: Jimp.FONT_SANS_32_WHITE,
  64: Jimp.FONT_SANS_64_WHITE,
  128: Jimp.FONT_SANS_128_WHITE
};

const fontCache = new Map();
async function font(size) {
  if (!fontCache.has(size)) {
    fontCache.set(size, await Jimp.loadFont(FONT_SIZES[size]));
  }
  return fontCache.get(size);
}

function printCentered(img, fnt, text, cx, cy) {
  const w = Jimp.measureText(fnt, text);
  const h = Jimp.measureTextHeight(fnt, text, w);
  img.print(fnt, cx - w / 2, cy - h / 2, text);
}

async function plainTile(size, letterFontSize) {
  const img = new Jimp(size, size, BLUE);
  printCentered(img, await font(letterFontSize), LETTER, size / 2, size / 2);
  return img;
}

async function wideTile() {
  const w = 310;
  const h = 150;
  const img = new Jimp(w, h, BLUE);
  printCentered(img, await font(64), LETTER, 75, h / 2);
  printCentered(img, await font(32), APP_NAME, 210, h / 2);
  return img;
}

async function largeTile() {
  const size = 310;
  const img = new Jimp(size, size, BLUE);
  printCentered(img, await font(128), LETTER, size / 2, 115);
  printCentered(img, await font(32), APP_NAME, size / 2, 230);
  return img;
}

const targets = [
  ['StoreLogo.png', () => plainTile(50, 32)],
  ['Square44x44Logo.png', () => plainTile(44, 32)],
  ['Square150x150Logo.png', () => plainTile(150, 64)],
  ['Wide310x150Logo.png', () => wideTile()],
  ['SmallTile.png', () => plainTile(71, 64)],
  ['LargeTile.png', () => largeTile()]
];

const outDir = path.join(process.cwd(), 'build', 'appx');
await mkdir(outDir, { recursive: true });

for (const [name, build] of targets) {
  const img = await build();
  const buf = await img.getBufferAsync(Jimp.MIME_PNG);
  await writeFile(path.join(outDir, name), buf);
  console.log('Wrote', path.join('build', 'appx', name), `(${buf.length} bytes)`);
}
