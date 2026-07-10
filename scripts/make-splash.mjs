// One-time developer helper to generate the NSIS portable-extraction splash
// image (assets/splash.bmp). Not used at runtime by the app itself.
import Jimp from 'jimp';
import path from 'node:path';

const WIDTH = 480;
const HEIGHT = 320;
const BLUE = 0x2563ebff;

const img = new Jimp(WIDTH, HEIGHT, BLUE);
const title = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
const subtitle = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);

const titleText = 'PDF Watermark Tool';
const subtitleText = 'Loading...';

const titleWidth = Jimp.measureText(title, titleText);
const subtitleWidth = Jimp.measureText(subtitle, subtitleText);

img.print(title, (WIDTH - titleWidth) / 2, HEIGHT / 2 - 40, titleText);
img.print(subtitle, (WIDTH - subtitleWidth) / 2, HEIGHT / 2 + 10, subtitleText);

const out = path.join(process.cwd(), 'assets', 'splash.bmp');
await img.writeAsync(out);
console.log('Wrote', out);
