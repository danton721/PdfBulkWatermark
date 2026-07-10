// One-time developer helper to fetch the U^2-Net ONNX model into assets/models.
// The shipped app never downloads anything; this only runs during setup/build.
import { createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';

const URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx';
const out = path.join(process.cwd(), 'assets', 'models', 'u2net.onnx');

if (existsSync(out)) { console.log('Model already present:', out); process.exit(0); }
mkdirSync(path.dirname(out), { recursive: true });
console.log('Downloading model to', out);
const res = await fetch(URL);
if (!res.ok) { console.error('Download failed:', res.status, res.statusText); process.exit(1); }
await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
console.log('Done.');
