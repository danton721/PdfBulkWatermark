// Resizes three source master images - an icon-only square mark, a square
// lockup with the "PDF Stamp" wordmark, and a 310x150 wide lockup - into
// every icon/tile size the win/appx build targets need. Small square tiles
// use the icon-only mark (text isn't legible below ~150px); the 310x310
// large tile has room for the icon+text lockup.
// Usage: node scripts/build-brand-assets.mjs [icon.png] [icon-text.png] [wide.png]
// Defaults to design/logo-square-icon.png, design/logo-square-text.png,
// design/logo-wide.png.
import Jimp from 'jimp';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const [, , iconArg, iconTextArg, wideArg] = process.argv;
const iconSrc = iconArg || path.join('design', 'logo-square-icon.png');
const iconTextSrc = iconTextArg || path.join('design', 'logo-square-text.png');
const wideSrc = wideArg || path.join('design', 'logo-wide.png');

const ICO_SIZES = [16, 32, 48, 256];
// Icon-only source: sizes too small for the wordmark to stay legible.
const APPX_SQUARE_ICON_ONLY = {
  'StoreLogo.png': 50,
  'Square44x44Logo.png': 44,
  'SmallTile.png': 71,
  'Square150x150Logo.png': 150
};
// Icon+text source: only the large tile has room for the wordmark.
const APPX_SQUARE_WITH_TEXT = {
  'LargeTile.png': 310
};
const WIDE = { name: 'Wide310x150Logo.png', w: 310, h: 150 };

function buildIco(frames) {
  const count = frames.length;
  const headerSize = 6 + 16 * count;
  let offset = headerSize;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  for (const { size, png } of frames) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height (0 = 256)
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bit count
    entry.writeUInt32LE(png.length, 8); // bytes in resource
    entry.writeUInt32LE(offset, 12); // image offset
    offset += png.length;
    entries.push(entry);
  }

  return Buffer.concat([header, ...entries, ...frames.map((f) => f.png)]);
}

async function coverResize(srcImg, w, h) {
  // .cover() scales+crops to exactly fill w x h (no distortion), like CSS object-fit: cover.
  const align = Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_CENTER;
  return srcImg.clone().cover(w, h, align, Jimp.RESIZE_BICUBIC);
}

const iconOnly = await Jimp.read(iconSrc);
const iconText = await Jimp.read(iconTextSrc);
const wide = await Jimp.read(wideSrc);

// assets/icon.ico (icon-only mark)
const icoFrames = [];
for (const size of ICO_SIZES) {
  const img = await coverResize(iconOnly, size, size);
  icoFrames.push({ size, png: await img.getBufferAsync(Jimp.MIME_PNG) });
}
const icoPath = path.join('assets', 'icon.ico');
await mkdir(path.dirname(icoPath), { recursive: true });
await writeFile(icoPath, buildIco(icoFrames));
console.log('Wrote', icoPath, `(${ICO_SIZES.join(', ')})`);

// build/appx/*.png square tiles
const appxDir = path.join('build', 'appx');
await mkdir(appxDir, { recursive: true });
for (const [name, size] of Object.entries(APPX_SQUARE_ICON_ONLY)) {
  const img = await coverResize(iconOnly, size, size);
  const out = path.join(appxDir, name);
  await img.writeAsync(out);
  console.log('Wrote', out, `(${size}x${size})`);
}
for (const [name, size] of Object.entries(APPX_SQUARE_WITH_TEXT)) {
  const img = await coverResize(iconText, size, size);
  const out = path.join(appxDir, name);
  await img.writeAsync(out);
  console.log('Wrote', out, `(${size}x${size})`);
}

// build/appx/Wide310x150Logo.png
const wideImg = await coverResize(wide, WIDE.w, WIDE.h);
const wideOut = path.join(appxDir, WIDE.name);
await wideImg.writeAsync(wideOut);
console.log('Wrote', wideOut, `(${WIDE.w}x${WIDE.h})`);
