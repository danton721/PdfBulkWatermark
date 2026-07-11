// One-time developer helper to generate assets/icon.ico, offline, so the
// packaged exe doesn't show electron-builder's default Electron icon.
// Windows Vista+ accepts PNG-encoded frames inside an ICO container at any
// size, so each frame is just a Jimp-rendered PNG - no BMP/AND-mask needed.
import Jimp from 'jimp';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

const BLUE = 0x2563ebff;
const SIZES = [16, 32, 48, 256];
// Best-fit bundled bitmap font per icon size (bigger sizes use bigger glyphs).
const FONT_FOR_SIZE = {
  16: Jimp.FONT_SANS_8_WHITE,
  32: Jimp.FONT_SANS_16_WHITE,
  48: Jimp.FONT_SANS_32_WHITE,
  256: Jimp.FONT_SANS_128_WHITE
};

async function renderFrame(size) {
  const img = new Jimp(size, size, BLUE);
  const font = await Jimp.loadFont(FONT_FOR_SIZE[size]);
  const text = 'W';
  const w = Jimp.measureText(font, text);
  const h = Jimp.measureTextHeight(font, text, w);
  img.print(font, (size - w) / 2, (size - h) / 2, text);
  return img.getBufferAsync(Jimp.MIME_PNG);
}

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

const frames = [];
for (const size of SIZES) {
  frames.push({ size, png: await renderFrame(size) });
}
const ico = buildIco(frames);
const out = path.join(process.cwd(), 'assets', 'icon.ico');
await writeFile(out, ico);
console.log('Wrote', out, `(${ico.length} bytes, ${SIZES.length} frames: ${SIZES.join(', ')})`);
