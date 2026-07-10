# PDF Watermark Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A portable Windows `.exe` (Electron) that stamps a shared `.jpg` watermark onto every page of one or more PDFs, with a 5-screen wizard, per-page overrides, optional local-AI background removal, opacity, and output to a chosen folder — running fully offline.

**Architecture:** Electron with three roles under strict context isolation. The **renderer** is a vanilla HTML/CSS/JS wizard that renders page previews with pdf.js and handles drag/resize in fraction space. The **main** process owns file dialogs, local-AI background removal (onnxruntime-node + jimp + a bundled U²-Net model), and final PDF writing (pdf-lib). A minimal **preload** bridges them. All pure logic (coordinate math, filename collision, generation) lives in testable Node modules. No network access anywhere.

**Tech Stack:** Electron, electron-builder (portable target), pdf.js (`pdfjs-dist`), pdf-lib, onnxruntime-node, jimp@0.22, Node's built-in `node:test` runner.

---

## File Structure

```
package.json                        # deps, scripts, electron-builder "build" config
.gitignore                          # (exists) + assets/models/*.onnx, dist/
scripts/fetch-model.mjs             # one-time dev download of the ONNX model (build-time only)
assets/icon.ico                     # app icon (optional placeholder)
assets/models/u2net.onnx            # bundled model (gitignored; present on disk for packaging)
src/main/main.js                    # app lifecycle, BrowserWindow, wires IPC
src/main/ipc.js                     # IPC handlers: dialogs, readPdf, removeBackground, generate
src/main/placement.js               # PURE: effective placement, fraction→points, filename collision
src/main/pdf-generator.js           # pdf-lib watermarking of one document
src/main/background-removal.js      # onnxruntime-node + jimp inference; graceful when model absent
src/preload/preload.js              # contextBridge API surface
src/renderer/index.html             # wizard shell (5 screens)
src/renderer/styles.css             # styles
src/renderer/app.js                 # wizard controller + shared state (ES module)
src/renderer/pdf-view.js            # pdf.js render helpers (ES module)
src/renderer/watermark-box.js       # draggable/resizable overlay in fraction space (ES module)
src/renderer/vendor/pdf.min.mjs     # copied from pdfjs-dist (offline)
src/renderer/vendor/pdf.worker.min.mjs
test/placement.test.js              # unit tests for placement.js
test/pdf-generator.test.js          # integration test for pdf-generator.js
test/fixtures/                      # generated at test time
```

**Data contract (used across tasks — keep names identical):**

```js
// Placement fractions are relative to page width/height. Origin top-left in UI/state.
GlobalPlacement = { xFrac, yFrac, wFrac, opacity }   // opacity 0..1
Override        = { xFrac, yFrac, wFrac } | { deleted: true }
pageKey         = `${fileIndex}:${pageIndex}`         // both 0-based

Watermark = { dataUrl, isPng, aspect }   // aspect = imgPixelWidth / imgPixelHeight

Job = {
  files: string[],
  watermark: Watermark,
  global: GlobalPlacement,
  overrides: { [pageKey]: Override },
  outputDir: string
}

// generate() resolves to:
GenerateResult = { results: Array<{ file, status:'ok'|'skipped'|'error', output?, reason? }> }
// progress events: { fileIndex, fileName, page, totalPages }
```

**Preload API (`window.api`) — the exact surface every task targets:**

```js
window.api = {
  selectPdfs: () => Promise<string[]>,
  selectWatermark: () => Promise<{ path, dataUrl, width, height } | null>,
  isModelAvailable: () => Promise<boolean>,
  removeBackground: (path) => Promise<{ dataUrl, width, height }>,
  readPdf: (path) => Promise<ArrayBuffer>,
  selectOutputDir: () => Promise<string | null>,
  generate: (job) => Promise<GenerateResult>,
  onProgress: (cb) => void,          // cb receives progress event objects
  openFolder: (path) => Promise<void>,
  basename: (path) => Promise<string>
}
```

---

## Task 1: Project scaffold + blank Electron window

**Files:**
- Create: `package.json`
- Create: `src/main/main.js`
- Create: `src/preload/preload.js`
- Create: `src/renderer/index.html`
- Create: `src/renderer/styles.css`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "pdf-watermark-tool",
  "version": "1.0.0",
  "description": "Add a .jpg watermark to every page of PDF files, fully offline.",
  "main": "src/main/main.js",
  "scripts": {
    "start": "electron .",
    "test": "node --test",
    "fetch-model": "node scripts/fetch-model.mjs",
    "dist": "electron-builder --win portable"
  },
  "author": "",
  "license": "MIT",
  "devDependencies": {
    "electron": "^31.0.0",
    "electron-builder": "^24.13.3"
  },
  "dependencies": {
    "pdf-lib": "^1.17.1",
    "pdfjs-dist": "^4.4.168",
    "onnxruntime-node": "^1.19.2",
    "jimp": "0.22.12"
  }
}
```

- [ ] **Step 2: Create `src/main/main.js`**

```js
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // needed so preload can require Node modules for IPC
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 3: Create a minimal `src/preload/preload.js` (expanded in Task 6)**

```js
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('api', {});
```

- [ ] **Step 4: Create `src/renderer/index.html` (shell; screens filled in later tasks)**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'" />
    <link rel="stylesheet" href="styles.css" />
    <title>PDF Watermark Tool</title>
  </head>
  <body>
    <header id="steps"></header>
    <main id="app"><h1 style="padding:24px">PDF Watermark Tool</h1></main>
    <footer id="nav"></footer>
    <script type="module" src="app.js"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `src/renderer/styles.css` (base)**

```css
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; font-family: "Segoe UI", system-ui, sans-serif; color: #1c1c1e; background: #f4f5f7; }
body { display: flex; flex-direction: column; }
header#steps { display: flex; gap: 8px; padding: 12px 20px; background: #fff; border-bottom: 1px solid #e2e4e8; }
header#steps .step { font-size: 13px; color: #8a8f98; padding: 4px 10px; border-radius: 14px; }
header#steps .step.active { color: #fff; background: #2563eb; }
header#steps .step.done { color: #2563eb; }
main#app { flex: 1; overflow: auto; padding: 20px; }
footer#nav { display: flex; justify-content: space-between; padding: 14px 20px; background: #fff; border-top: 1px solid #e2e4e8; }
button { font-size: 14px; padding: 9px 18px; border-radius: 8px; border: 1px solid #cfd2d8; background: #fff; cursor: pointer; }
button.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
button:disabled { opacity: .45; cursor: default; }
.file-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #fff; border: 1px solid #e2e4e8; border-radius: 8px; margin-bottom: 8px; }
```

- [ ] **Step 6: Create a temporary `src/renderer/app.js` placeholder**

```js
// Replaced in Task 9. Placeholder so the module script loads.
console.log('renderer ready');
```

- [ ] **Step 7: Install deps and run**

Run: `npm install`
Then run: `npm start`
Expected: a blank window titled "PDF Watermark Tool" showing the heading; DevTools console logs "renderer ready". Close the window.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Electron app shell"
```

---

## Task 2: Placement math + filename collision (pure, TDD)

**Files:**
- Create: `src/main/placement.js`
- Test: `test/placement.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/placement.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveEffective, fractionToPdfRect, nextAvailableName } = require('../src/main/placement');

test('resolveEffective returns global when no override', () => {
  const g = { xFrac: 0.1, yFrac: 0.2, wFrac: 0.3 };
  assert.deepStrictEqual(resolveEffective(g, undefined), { xFrac: 0.1, yFrac: 0.2, wFrac: 0.3 });
});

test('resolveEffective returns null when deleted', () => {
  assert.strictEqual(resolveEffective({ xFrac: 0.1, yFrac: 0.2, wFrac: 0.3 }, { deleted: true }), null);
});

test('resolveEffective returns override when present', () => {
  const g = { xFrac: 0.1, yFrac: 0.2, wFrac: 0.3 };
  const o = { xFrac: 0.5, yFrac: 0.6, wFrac: 0.2 };
  assert.deepStrictEqual(resolveEffective(g, o), o);
});

test('fractionToPdfRect flips origin to bottom-left and keeps aspect', () => {
  // page 200x100 pts, image aspect 2 (wide). wFrac .5 => width 100, height 50.
  // xFrac .25 => x 50. yFrac .1 (top) => y = 100 - 10 - 50 = 40.
  const r = fractionToPdfRect({ xFrac: 0.25, yFrac: 0.1, wFrac: 0.5 }, 200, 100, 2);
  assert.deepStrictEqual(r, { x: 50, y: 40, width: 100, height: 50 });
});

test('fractionToPdfRect handles tall image aspect', () => {
  // page 100x200, aspect 0.5 (tall). wFrac .5 => width 50, height 100.
  // yFrac 0 (top) => y = 200 - 0 - 100 = 100.
  const r = fractionToPdfRect({ xFrac: 0, yFrac: 0, wFrac: 0.5 }, 100, 200, 0.5);
  assert.deepStrictEqual(r, { x: 0, y: 100, width: 50, height: 100 });
});

test('nextAvailableName returns name when free', () => {
  assert.strictEqual(nextAvailableName(() => false, 'a.pdf'), 'a.pdf');
});

test('nextAvailableName suffixes on collision', () => {
  const taken = new Set(['a.pdf', 'a (1).pdf']);
  assert.strictEqual(nextAvailableName((n) => taken.has(n), 'a.pdf'), 'a (2).pdf');
});

test('nextAvailableName handles no extension', () => {
  const taken = new Set(['file']);
  assert.strictEqual(nextAvailableName((n) => taken.has(n), 'file'), 'file (1)');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot find module `../src/main/placement`.

- [ ] **Step 3: Implement `src/main/placement.js`**

```js
'use strict';

function resolveEffective(global, override) {
  if (!override) {
    return { xFrac: global.xFrac, yFrac: global.yFrac, wFrac: global.wFrac };
  }
  if (override.deleted) return null;
  return { xFrac: override.xFrac, yFrac: override.yFrac, wFrac: override.wFrac };
}

// p: {xFrac,yFrac,wFrac} with top-left origin. pageW/pageH in points.
// imageAspect = imgPixelWidth / imgPixelHeight. Returns pdf-lib rect (bottom-left origin).
function fractionToPdfRect(p, pageW, pageH, imageAspect) {
  const width = p.wFrac * pageW;
  const height = width / imageAspect;
  const x = p.xFrac * pageW;
  const y = pageH - (p.yFrac * pageH) - height;
  return { x, y, width, height };
}

// existsFn(name) => bool. Returns first non-colliding name, suffixing " (n)".
function nextAvailableName(existsFn, filename) {
  if (!existsFn(filename)) return filename;
  const dot = filename.lastIndexOf('.');
  const base = dot === -1 ? filename : filename.slice(0, dot);
  const ext = dot === -1 ? '' : filename.slice(dot);
  let n = 1;
  while (existsFn(`${base} (${n})${ext}`)) n++;
  return `${base} (${n})${ext}`;
}

module.exports = { resolveEffective, fractionToPdfRect, nextAvailableName };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/main/placement.js test/placement.test.js
git commit -m "feat: placement math and filename collision helpers"
```

---

## Task 3: PDF generator (integration, TDD)

**Files:**
- Create: `src/main/pdf-generator.js`
- Test: `test/pdf-generator.test.js`

**Interface:** `watermarkDocument({ pdfBytes, image: { bytes, isPng, aspect }, global, overrides, fileIndex, onPage }) => Promise<Uint8Array>` — returns watermarked PDF bytes. `onPage(pageIndex,total)` is an optional progress callback.

- [ ] **Step 1: Write the failing test**

```js
// test/pdf-generator.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { PDFDocument, rgb } = require('pdf-lib');
const { watermarkDocument } = require('../src/main/pdf-generator');

// 1x1 red PNG (opaque), base64.
const RED_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function makePdf(nPages) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < nPages; i++) {
    const p = doc.addPage([200, 100]);
    p.drawRectangle({ x: 0, y: 0, width: 200, height: 100, color: rgb(1, 1, 1) });
  }
  return doc.save();
}

test('watermarks every page by default', async () => {
  const pdfBytes = await makePdf(3);
  const image = { bytes: Buffer.from(RED_PNG_B64, 'base64'), isPng: true, aspect: 1 };
  const out = await watermarkDocument({
    pdfBytes, image,
    global: { xFrac: 0.25, yFrac: 0.1, wFrac: 0.5, opacity: 0.5 },
    overrides: {}, fileIndex: 0
  });
  const reloaded = await PDFDocument.load(out);
  assert.strictEqual(reloaded.getPageCount(), 3);
  // Each page should now reference at least one image XObject.
  for (const page of reloaded.getPages()) {
    const xobjs = page.node.Resources()?.lookup(require('pdf-lib').PDFName.of('XObject'));
    assert.ok(xobjs, 'expected an XObject on the page');
  }
});

test('skips a page marked deleted', async () => {
  const pdfBytes = await makePdf(2);
  const image = { bytes: Buffer.from(RED_PNG_B64, 'base64'), isPng: true, aspect: 1 };
  const out = await watermarkDocument({
    pdfBytes, image,
    global: { xFrac: 0.25, yFrac: 0.1, wFrac: 0.5, opacity: 1 },
    overrides: { '0:1': { deleted: true } }, fileIndex: 0
  });
  const reloaded = await PDFDocument.load(out);
  const p0 = reloaded.getPage(0).node.Resources()?.lookup(require('pdf-lib').PDFName.of('XObject'));
  const p1 = reloaded.getPage(1).node.Resources()?.lookup(require('pdf-lib').PDFName.of('XObject'));
  assert.ok(p0, 'page 0 should be watermarked');
  assert.ok(!p1, 'page 1 should have no watermark');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pdf-generator.test.js`
Expected: FAIL — cannot find module `../src/main/pdf-generator`.

- [ ] **Step 3: Implement `src/main/pdf-generator.js`**

```js
'use strict';
const { PDFDocument } = require('pdf-lib');
const { resolveEffective, fractionToPdfRect } = require('./placement');

// Watermark one document. Returns Uint8Array of the new PDF.
async function watermarkDocument({ pdfBytes, image, global, overrides, fileIndex, onPage }) {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: false });
  const embedded = image.isPng
    ? await doc.embedPng(image.bytes)
    : await doc.embedJpg(image.bytes);

  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    if (onPage) onPage(i, pages.length);
    const key = `${fileIndex}:${i}`;
    const eff = resolveEffective(global, overrides[key]);
    if (!eff) continue; // deleted on this page
    const page = pages[i];
    const { width: pw, height: ph } = page.getSize();
    const rect = fractionToPdfRect(eff, pw, ph, image.aspect);
    page.drawImage(embedded, {
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      opacity: global.opacity
    });
  }
  return doc.save();
}

module.exports = { watermarkDocument };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/pdf-generator.test.js`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add src/main/pdf-generator.js test/pdf-generator.test.js
git commit -m "feat: pdf-lib document watermarking with per-page overrides"
```

---

## Task 4: Background-removal module (local AI, graceful fallback)

**Files:**
- Create: `src/main/background-removal.js`
- Create: `scripts/fetch-model.mjs`

**Design:** Model file at `assets/models/u2net.onnx`. If missing, `isModelAvailable()` returns false and the UI disables the toggle — the app stays fully functional for plain watermarking. Preprocessing matches the standard U²-Net pipeline (320×320, mean/std normalize); output saliency map becomes the alpha channel of a transparent PNG.

- [ ] **Step 1: Create `scripts/fetch-model.mjs` (build-time only; run once with internet)**

```js
// One-time developer helper to fetch the U^2-Net ONNX model into assets/models.
// The shipped app never downloads anything; this only runs during setup/build.
import { createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx';
const out = path.join(process.cwd(), 'assets', 'models', 'u2net.onnx');

if (existsSync(out)) { console.log('Model already present:', out); process.exit(0); }
mkdirSync(path.dirname(out), { recursive: true });
console.log('Downloading model to', out);
const res = await fetch(URL);
if (!res.ok) { console.error('Download failed:', res.status, res.statusText); process.exit(1); }
await pipeline(res.body, createWriteStream(out));
console.log('Done.');
```

- [ ] **Step 2: Implement `src/main/background-removal.js`**

```js
'use strict';
const path = require('path');
const fs = require('fs');
const Jimp = require('jimp');

const MODEL_PATH = path.join(__dirname, '..', '..', 'assets', 'models', 'u2net.onnx');
const SIZE = 320;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let sessionPromise = null;

function isModelAvailable() {
  return fs.existsSync(MODEL_PATH);
}

async function getSession() {
  if (!sessionPromise) {
    const ort = require('onnxruntime-node');
    sessionPromise = ort.InferenceSession.create(MODEL_PATH);
  }
  return sessionPromise;
}

// Returns a Buffer of a transparent PNG with the background removed.
async function removeBackground(imagePath) {
  if (!isModelAvailable()) throw new Error('Background-removal model not installed.');
  const ort = require('onnxruntime-node');
  const session = await getSession();

  const original = await Jimp.read(imagePath);
  const ow = original.bitmap.width;
  const oh = original.bitmap.height;

  // Resize copy to 320x320 for the network.
  const small = original.clone().resize(SIZE, SIZE, Jimp.RESIZE_BILINEAR);
  const d = small.bitmap.data; // RGBA
  // Find max pixel value (U^2-Net divides by max, not by 255).
  let maxVal = 1e-6;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > maxVal) maxVal = d[i];
    if (d[i + 1] > maxVal) maxVal = d[i + 1];
    if (d[i + 2] > maxVal) maxVal = d[i + 2];
  }
  // Build CHW float tensor with mean/std normalization.
  const input = new Float32Array(3 * SIZE * SIZE);
  const plane = SIZE * SIZE;
  for (let p = 0, j = 0; p < d.length; p += 4, j++) {
    const r = d[p] / maxVal, g = d[p + 1] / maxVal, b = d[p + 2] / maxVal;
    input[j] = (r - MEAN[0]) / STD[0];
    input[plane + j] = (g - MEAN[1]) / STD[1];
    input[2 * plane + j] = (b - MEAN[2]) / STD[2];
  }
  const tensor = new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]);
  const feeds = { [session.inputNames[0]]: tensor };
  const results = await session.run(feeds);
  const out = results[session.outputNames[0]].data; // length SIZE*SIZE (channel 0)

  // Normalize saliency map to 0..1.
  let mi = Infinity, ma = -Infinity;
  for (let i = 0; i < plane; i++) { if (out[i] < mi) mi = out[i]; if (out[i] > ma) ma = out[i]; }
  const range = (ma - mi) || 1e-6;

  // Build a 320x320 grayscale mask image, then resize to original size.
  const mask = new Jimp(SIZE, SIZE, 0x000000ff);
  for (let i = 0; i < plane; i++) {
    const v = Math.round(((out[i] - mi) / range) * 255);
    const idx = i * 4;
    mask.bitmap.data[idx] = v;
    mask.bitmap.data[idx + 1] = v;
    mask.bitmap.data[idx + 2] = v;
    mask.bitmap.data[idx + 3] = 255;
  }
  mask.resize(ow, oh, Jimp.RESIZE_BILINEAR);

  // Apply mask as alpha on a copy of the original.
  const result = original.clone();
  const rd = result.bitmap.data;
  const md = mask.bitmap.data;
  for (let i = 0; i < rd.length; i += 4) {
    rd[i + 3] = md[i]; // use mask's red channel as alpha
  }
  return result.getBufferAsync(Jimp.MIME_PNG);
}

module.exports = { isModelAvailable, removeBackground, MODEL_PATH };
```

- [ ] **Step 3: Smoke-test the graceful path (no model needed)**

Create a throwaway check and run it:

Run:
```bash
node -e "const b=require('./src/main/background-removal'); console.log('available:', b.isModelAvailable());"
```
Expected: prints `available: false` (model not fetched yet) — confirms the module loads and the guard works without crashing.

- [ ] **Step 4: Commit**

```bash
git add src/main/background-removal.js scripts/fetch-model.mjs
git commit -m "feat: local AI background removal with graceful no-model fallback"
```

---

## Task 5: Preload API + IPC handlers

**Files:**
- Create: `src/main/ipc.js`
- Modify: `src/main/main.js` (call `registerIpc()`)
- Modify: `src/preload/preload.js` (full API)

- [ ] **Step 1: Implement `src/main/ipc.js`**

```js
'use strict';
const { ipcMain, dialog, shell, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const { watermarkDocument } = require('./pdf-generator');
const { nextAvailableName } = require('./placement');
const bg = require('./background-removal');

async function imageToDataUrl(filePath) {
  const img = await Jimp.read(filePath);
  const dataUrl = await img.getBase64Async(Jimp.MIME_PNG);
  return { dataUrl, width: img.bitmap.width, height: img.bitmap.height };
}

function registerIpc() {
  ipcMain.handle('select-pdfs', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Select PDF files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('select-watermark', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Select watermark image',
      properties: ['openFile'],
      filters: [{ name: 'JPEG', extensions: ['jpg', 'jpeg'] }]
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    const p = r.filePaths[0];
    const meta = await imageToDataUrl(p);
    return { path: p, ...meta };
  });

  ipcMain.handle('is-model-available', async () => bg.isModelAvailable());

  ipcMain.handle('remove-background', async (_e, imagePath) => {
    const png = await bg.removeBackground(imagePath);
    const img = await Jimp.read(png);
    const dataUrl = await img.getBase64Async(Jimp.MIME_PNG);
    return { dataUrl, width: img.bitmap.width, height: img.bitmap.height };
  });

  ipcMain.handle('read-pdf', async (_e, filePath) => {
    const buf = await fs.promises.readFile(filePath);
    // Return a transferable ArrayBuffer slice.
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  ipcMain.handle('select-output-dir', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Select output folder',
      properties: ['openDirectory', 'createDirectory']
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('basename', async (_e, p) => path.basename(p));

  ipcMain.handle('open-folder', async (_e, p) => { await shell.openPath(p); });

  ipcMain.handle('generate', async (event, job) => {
    const results = [];
    const b64 = job.watermark.dataUrl.split(',')[1];
    const image = {
      bytes: Buffer.from(b64, 'base64'),
      isPng: job.watermark.isPng,
      aspect: job.watermark.aspect
    };
    const usedNames = new Set();

    for (let fi = 0; fi < job.files.length; fi++) {
      const file = job.files[fi];
      const name = path.basename(file);
      try {
        const pdfBytes = await fs.promises.readFile(file);
        const out = await watermarkDocument({
          pdfBytes, image,
          global: job.global,
          overrides: job.overrides,
          fileIndex: fi,
          onPage: (page, totalPages) =>
            event.sender.send('generate-progress', { fileIndex: fi, fileName: name, page, totalPages })
        });
        const finalName = nextAvailableName(
          (n) => usedNames.has(n) || fs.existsSync(path.join(job.outputDir, n)),
          name
        );
        usedNames.add(finalName);
        const outPath = path.join(job.outputDir, finalName);
        await fs.promises.writeFile(outPath, out);
        results.push({ file, status: 'ok', output: outPath });
      } catch (err) {
        results.push({ file, status: 'error', reason: err.message });
      }
    }
    return { results };
  });
}

module.exports = { registerIpc };
```

- [ ] **Step 2: Wire `registerIpc()` into `src/main/main.js`**

Add near the top after the existing `require` lines:

```js
const { registerIpc } = require('./ipc');
```

And inside `app.whenReady().then(() => { ... })`, add `registerIpc();` as the first line:

```js
app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
```

- [ ] **Step 3: Replace `src/preload/preload.js` with the full API**

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectPdfs: () => ipcRenderer.invoke('select-pdfs'),
  selectWatermark: () => ipcRenderer.invoke('select-watermark'),
  isModelAvailable: () => ipcRenderer.invoke('is-model-available'),
  removeBackground: (p) => ipcRenderer.invoke('remove-background', p),
  readPdf: (p) => ipcRenderer.invoke('read-pdf', p),
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  basename: (p) => ipcRenderer.invoke('basename', p),
  openFolder: (p) => ipcRenderer.invoke('open-folder', p),
  generate: (job) => ipcRenderer.invoke('generate', job),
  onProgress: (cb) => ipcRenderer.on('generate-progress', (_e, data) => cb(data))
});
```

- [ ] **Step 4: Verify the bridge loads**

Run: `npm start`
In DevTools console (View menu is hidden; open with Ctrl+Shift+I), run: `await window.api.isModelAvailable()`
Expected: returns `false` (no model yet) with no errors. Close the window.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.js src/main/main.js src/preload/preload.js
git commit -m "feat: IPC handlers and preload bridge"
```

---

## Task 6: Vendor pdf.js + rendering helper

**Files:**
- Create: `src/renderer/vendor/pdf.min.mjs` (copied)
- Create: `src/renderer/vendor/pdf.worker.min.mjs` (copied)
- Create: `src/renderer/pdf-view.js`

- [ ] **Step 1: Copy pdf.js dist files into the renderer vendor folder**

Run:
```bash
mkdir -p src/renderer/vendor
cp node_modules/pdfjs-dist/build/pdf.min.mjs src/renderer/vendor/pdf.min.mjs
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs src/renderer/vendor/pdf.worker.min.mjs
```
Expected: both files exist under `src/renderer/vendor/`. (If the `.min.mjs` names differ in the installed version, copy the non-min `pdf.mjs` / `pdf.worker.mjs` equivalents and adjust the filenames in Step 2.)

- [ ] **Step 2: Implement `src/renderer/pdf-view.js`**

```js
import * as pdfjs from './vendor/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';

const docCache = new Map(); // filePath -> pdfDocument proxy

export async function loadDoc(filePath) {
  if (docCache.has(filePath)) return docCache.get(filePath);
  const buf = await window.api.readPdf(filePath);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  docCache.set(filePath, doc);
  return doc;
}

export async function pageCount(filePath) {
  const doc = await loadDoc(filePath);
  return doc.numPages;
}

// Renders page (1-based) into a canvas fitted to maxWidth px. Returns { canvas, cssWidth, cssHeight }.
export async function renderPage(filePath, pageNumber, maxWidth) {
  const doc = await loadDoc(filePath);
  const page = await doc.getPage(pageNumber);
  const unscaled = page.getViewport({ scale: 1 });
  const scale = maxWidth / unscaled.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, cssWidth: canvas.width, cssHeight: canvas.height };
}
```

- [ ] **Step 3: Manual smoke test**

Temporarily edit `src/renderer/app.js` to:

```js
import { renderPage } from './pdf-view.js';
window.__test = async (path) => {
  const { canvas } = await renderPage(path, 1, 500);
  document.getElementById('app').appendChild(canvas);
};
console.log('call window.__test("C:/full/path/to/some.pdf")');
```

Run: `npm start`, then in DevTools run `await window.__test("<a real pdf path>")`.
Expected: page 1 renders visibly in the window. Then revert `app.js` to the placeholder (it is fully replaced in Task 8).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/vendor src/renderer/pdf-view.js
git commit -m "feat: offline pdf.js page rendering helper"
```

---

## Task 7: Watermark overlay component (drag/resize in fraction space)

**Files:**
- Create: `src/renderer/watermark-box.js`

**Interface:** `createWatermarkBox(container, { dataUrl, aspect, opacity, placement, onChange })` returns `{ setPlacement, setOpacity, destroy }`. `container` is a positioned element sized to the rendered page. `placement` is `{ xFrac, yFrac, wFrac }`. Emits `onChange(placement)` during drag/resize. Aspect ratio is locked.

- [ ] **Step 1: Implement `src/renderer/watermark-box.js`**

```js
// A draggable + corner-resizable watermark overlay. Stores state in fraction space
// (relative to the container's pixel size) so it maps across different page sizes.
export function createWatermarkBox(container, opts) {
  const { dataUrl, aspect, onChange } = opts;
  let placement = { ...opts.placement };
  let opacity = opts.opacity ?? 1;

  const box = document.createElement('div');
  box.className = 'wm-box';
  const img = document.createElement('img');
  img.src = dataUrl;
  img.draggable = false;
  box.appendChild(img);
  const handle = document.createElement('div');
  handle.className = 'wm-handle';
  box.appendChild(handle);
  container.appendChild(box);

  function px() { return { w: container.clientWidth, h: container.clientHeight }; }

  function apply() {
    const { w, h } = px();
    const width = placement.wFrac * w;
    const height = width / aspect;
    box.style.left = (placement.xFrac * w) + 'px';
    box.style.top = (placement.yFrac * h) + 'px';
    box.style.width = width + 'px';
    box.style.height = height + 'px';
    box.style.opacity = String(opacity);
  }

  function clamp() {
    const { w, h } = px();
    const width = placement.wFrac * w;
    const height = width / aspect;
    placement.xFrac = Math.min(Math.max(0, placement.xFrac), Math.max(0, (w - width) / w));
    placement.yFrac = Math.min(Math.max(0, placement.yFrac), Math.max(0, (h - height) / h));
  }

  // Dragging the body.
  box.addEventListener('pointerdown', (e) => {
    if (e.target === handle) return;
    e.preventDefault();
    box.setPointerCapture(e.pointerId);
    const { w, h } = px();
    const startX = e.clientX, startY = e.clientY;
    const sx = placement.xFrac, sy = placement.yFrac;
    const move = (ev) => {
      placement.xFrac = sx + (ev.clientX - startX) / w;
      placement.yFrac = sy + (ev.clientY - startY) / h;
      clamp(); apply(); onChange && onChange({ ...placement });
    };
    const up = (ev) => {
      box.releasePointerCapture(e.pointerId);
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', up);
    };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', up);
  });

  // Resizing from the bottom-right handle (top-left anchored, aspect locked).
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    const { w } = px();
    const startX = e.clientX;
    const sw = placement.wFrac;
    const move = (ev) => {
      const deltaFrac = (ev.clientX - startX) / w;
      placement.wFrac = Math.min(Math.max(0.03, sw + deltaFrac), 1);
      clamp(); apply(); onChange && onChange({ ...placement });
    };
    const up = () => {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });

  apply();

  return {
    setPlacement(p) { placement = { ...p }; clamp(); apply(); },
    setOpacity(o) { opacity = o; apply(); },
    getPlacement() { return { ...placement }; },
    destroy() { box.remove(); }
  };
}
```

- [ ] **Step 2: Add overlay styles to `src/renderer/styles.css`**

```css
.page-stage { position: relative; display: inline-block; box-shadow: 0 2px 12px rgba(0,0,0,.15); }
.page-stage canvas { display: block; }
.wm-box { position: absolute; cursor: move; outline: 1px dashed #2563eb; }
.wm-box img { width: 100%; height: 100%; display: block; pointer-events: none; }
.wm-handle { position: absolute; right: -7px; bottom: -7px; width: 14px; height: 14px; background: #2563eb; border: 2px solid #fff; border-radius: 3px; cursor: nwse-resize; }
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/watermark-box.js src/renderer/styles.css
git commit -m "feat: draggable/resizable watermark overlay in fraction space"
```

---

## Task 8: Wizard controller + Screens 1 & 2

**Files:**
- Modify: `src/renderer/index.html` (screen containers)
- Create/replace: `src/renderer/app.js` (full wizard)

- [ ] **Step 1: Replace `<main id="app">` content in `index.html`**

Replace the `<main>` element with:

```html
<main id="app">
  <section data-screen="1" class="screen">
    <h2>1. Select PDF files</h2>
    <button id="add-pdfs" class="primary">Add PDFs…</button>
    <div id="pdf-list" style="margin-top:14px"></div>
  </section>

  <section data-screen="2" class="screen" hidden>
    <h2>2. Choose watermark image</h2>
    <button id="choose-wm" class="primary">Choose .jpg…</button>
    <div id="wm-preview" style="margin-top:14px"></div>
    <label style="display:flex;align-items:center;gap:8px;margin-top:14px">
      <input type="checkbox" id="rmbg" /> Remove background (local AI)
      <span id="rmbg-note" style="color:#8a8f98;font-size:13px"></span>
    </label>
    <label style="display:block;margin-top:14px">Opacity: <span id="op-val">50</span>%
      <input type="range" id="opacity" min="0" max="100" value="50" style="width:260px;vertical-align:middle" />
    </label>
  </section>

  <section data-screen="3" class="screen" hidden>
    <h2>3. Position &amp; size on page 1</h2>
    <div id="stage3"></div>
  </section>

  <section data-screen="4" class="screen" hidden>
    <h2>4. Review all pages</h2>
    <div id="grid" style="display:flex;flex-wrap:wrap;gap:14px"></div>
    <div id="editor" hidden></div>
  </section>

  <section data-screen="5" class="screen" hidden>
    <h2>5. Save</h2>
    <button id="choose-out" class="primary">Choose output folder…</button>
    <div id="out-path" style="margin-top:10px;color:#555"></div>
    <div id="progress" style="margin-top:14px"></div>
    <div id="summary" style="margin-top:14px"></div>
  </section>
</main>
```

- [ ] **Step 2: Create `src/renderer/app.js` (state + Screens 1–2 + navigation; Screens 3–5 wired in Task 9)**

```js
import { renderPage, pageCount } from './pdf-view.js';
import { createWatermarkBox } from './watermark-box.js';

const state = {
  step: 1,
  files: [],
  watermark: null,          // { path, originalDataUrl, dataUrl, isPng, aspect }
  removeBg: false,
  bgCache: null,            // processed { dataUrl, aspect }
  global: { xFrac: 0.35, yFrac: 0.4, wFrac: 0.3, opacity: 0.5 },
  overrides: {},            // pageKey -> {xFrac,yFrac,wFrac} | {deleted:true}
  pages: [],                // [{ fileIndex, pageIndex }]
  outputDir: null
};

const $ = (sel) => document.querySelector(sel);
const screens = [...document.querySelectorAll('.screen')];

function renderSteps() {
  const labels = ['Files', 'Watermark', 'Position', 'Review', 'Save'];
  $('#steps').innerHTML = labels.map((l, i) => {
    const n = i + 1;
    const cls = n === state.step ? 'active' : (n < state.step ? 'done' : '');
    return `<span class="step ${cls}">${n}. ${l}</span>`;
  }).join('');
}

function show(step) {
  state.step = step;
  screens.forEach((s) => { s.hidden = Number(s.dataset.screen) !== step; });
  renderSteps();
  renderNav();
  if (step === 3) enterPosition();
  if (step === 4) enterReview();
  if (step === 5) enterSave();
}

function canNext() {
  if (state.step === 1) return state.files.length > 0;
  if (state.step === 2) return !!state.watermark && (!state.removeBg || !!state.bgCache);
  if (state.step === 5) return false;
  return true;
}

function renderNav() {
  const back = state.step > 1
    ? `<button id="back">Back</button>` : `<span></span>`;
  const next = state.step < 5
    ? `<button id="next" class="primary" ${canNext() ? '' : 'disabled'}>Next</button>`
    : `<span></span>`;
  $('#nav').innerHTML = back + next;
  const b = $('#back'); if (b) b.onclick = () => show(state.step - 1);
  const n = $('#next'); if (n) n.onclick = () => show(state.step + 1);
}

// ---------- Screen 1: files ----------
function renderFileList() {
  $('#pdf-list').innerHTML = state.files.map((f, i) =>
    `<div class="file-row"><span data-name="${i}">${f}</span>
     <button data-remove="${i}">Remove</button></div>`).join('') || '<p style="color:#8a8f98">No files yet.</p>';
  state.files.forEach(async (f, i) => {
    const el = document.querySelector(`[data-name="${i}"]`);
    if (el) el.textContent = await window.api.basename(f);
  });
  document.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.onclick = () => { state.files.splice(Number(btn.dataset.remove), 1); renderFileList(); renderNav(); };
  });
}

$('#add-pdfs').onclick = async () => {
  const picked = await window.api.selectPdfs();
  for (const p of picked) if (!state.files.includes(p)) state.files.push(p);
  renderFileList(); renderNav();
};

// ---------- Screen 2: watermark ----------
async function refreshWatermarkImage() {
  // Determine the dataUrl/aspect actually used based on the removeBg toggle.
  if (state.removeBg) {
    if (!state.bgCache) {
      $('#rmbg-note').textContent = 'processing…';
      try {
        const r = await window.api.removeBackground(state.watermark.path);
        state.bgCache = { dataUrl: r.dataUrl, aspect: r.width / r.height };
      } catch (e) {
        $('#rmbg-note').textContent = 'failed: ' + e.message;
        $('#rmbg').checked = false; state.removeBg = false;
      }
    }
    if (state.bgCache) {
      state.watermark.dataUrl = state.bgCache.dataUrl;
      state.watermark.isPng = true;
      state.watermark.aspect = state.bgCache.aspect;
      $('#rmbg-note').textContent = 'done';
    }
  } else {
    state.watermark.dataUrl = state.watermark.originalDataUrl;
    state.watermark.isPng = true; // originalDataUrl is a PNG data URL from Jimp
    $('#rmbg-note').textContent = '';
  }
  const prev = $('#wm-preview');
  prev.innerHTML = `<img src="${state.watermark.dataUrl}" style="max-width:320px;max-height:220px;background:
    repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50%/16px 16px;border:1px solid #e2e4e8"/>`;
  renderNav();
}

$('#choose-wm').onclick = async () => {
  const wm = await window.api.selectWatermark();
  if (!wm) return;
  state.watermark = {
    path: wm.path,
    originalDataUrl: wm.dataUrl,   // PNG data URL (Jimp-encoded), opaque
    dataUrl: wm.dataUrl,
    isPng: true,
    aspect: wm.width / wm.height
  };
  state.bgCache = null;
  state.removeBg = false;
  $('#rmbg').checked = false;
  await refreshWatermarkImage();
};

$('#rmbg').onchange = async (e) => {
  state.removeBg = e.target.checked;
  if (!state.watermark) return;
  await refreshWatermarkImage();
};

$('#opacity').oninput = (e) => {
  const v = Number(e.target.value);
  $('#op-val').textContent = String(v);
  state.global.opacity = v / 100;
  if (window.__wmBox3) window.__wmBox3.setOpacity(state.global.opacity);
};

// Initialize model-availability note.
(async () => {
  const ok = await window.api.isModelAvailable();
  if (!ok) {
    $('#rmbg').disabled = true;
    $('#rmbg-note').textContent = '(model not installed)';
  }
})();

// Screens 3–5 handlers are defined in Task 9 (appended to this file).
window.__state = state;
window.__nav = { show, renderNav };
export {}; // module

show(1);
```

- [ ] **Step 3: Manual verification of Screens 1–2**

Run: `npm start`
- Click "Add PDFs…", select 2 PDFs → they list with basenames and Remove buttons; Next enables.
- Remove one → list updates.
- Go Next → Screen 2. Click "Choose .jpg…", pick an image → checkerboard-backed preview shows; Next enables.
- Move opacity slider → value label updates.
- The "Remove background" checkbox is disabled with "(model not installed)" (expected until Task 10).

Close the window.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/index.html src/renderer/app.js
git commit -m "feat: wizard shell with files and watermark screens"
```

---

## Task 9: Screens 3 (position), 4 (review), 5 (save)

**Files:**
- Modify: `src/renderer/app.js` (append screen logic)
- Modify: `src/renderer/styles.css` (thumb styles)

- [ ] **Step 1: Append Screen 3/4/5 logic to `src/renderer/app.js`** (add below `window.__nav = ...`, before `show(1);` — move `show(1);` to the very end)

```js
// ---------- shared: build the page list ----------
async function buildPageList() {
  state.pages = [];
  for (let fi = 0; fi < state.files.length; fi++) {
    const n = await pageCount(state.files[fi]);
    for (let pi = 0; pi < n; pi++) state.pages.push({ fileIndex: fi, pageIndex: pi });
  }
}

// ---------- Screen 3: position on first page ----------
async function enterPosition() {
  const host = document.getElementById('stage3');
  host.innerHTML = 'Rendering…';
  const { canvas } = await renderPage(state.files[0], 1, 720);
  host.innerHTML = '';
  const stage = document.createElement('div');
  stage.className = 'page-stage';
  stage.style.width = canvas.width + 'px';
  stage.style.height = canvas.height + 'px';
  stage.appendChild(canvas);
  host.appendChild(stage);
  if (window.__wmBox3) window.__wmBox3.destroy();
  window.__wmBox3 = createWatermarkBox(stage, {
    dataUrl: state.watermark.dataUrl,
    aspect: state.watermark.aspect,
    opacity: state.global.opacity,
    placement: { xFrac: state.global.xFrac, yFrac: state.global.yFrac, wFrac: state.global.wFrac },
    onChange: (p) => { state.global.xFrac = p.xFrac; state.global.yFrac = p.yFrac; state.global.wFrac = p.wFrac; }
  });
}

// ---------- Screen 4: review all pages ----------
function effectiveFor(key) {
  const o = state.overrides[key];
  if (o && o.deleted) return null;
  if (o) return { xFrac: o.xFrac, yFrac: o.yFrac, wFrac: o.wFrac };
  return { xFrac: state.global.xFrac, yFrac: state.global.yFrac, wFrac: state.global.wFrac };
}

async function enterReview() {
  await buildPageList();
  const grid = document.getElementById('grid');
  document.getElementById('editor').hidden = true;
  grid.innerHTML = '';
  state.pages.forEach((pg, idx) => {
    const key = `${pg.fileIndex}:${pg.pageIndex}`;
    const card = document.createElement('div');
    card.className = 'thumb';
    card.dataset.idx = String(idx);
    card.innerHTML = `<div class="thumb-canvas">loading…</div>
      <div class="thumb-label">file ${pg.fileIndex + 1}, p.${pg.pageIndex + 1}</div>`;
    grid.appendChild(card);
    card.onclick = () => openEditor(idx);
    lazyRenderThumb(card, pg, key);
  });
}

const thumbObserver = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (en.isIntersecting) { en.target.__render(); thumbObserver.unobserve(en.target); }
  });
}, { rootMargin: '200px' });

function lazyRenderThumb(card, pg, key) {
  card.__render = async () => {
    const holder = card.querySelector('.thumb-canvas');
    const { canvas } = await renderPage(state.files[pg.fileIndex], pg.pageIndex + 1, 200);
    holder.innerHTML = '';
    const stage = document.createElement('div');
    stage.className = 'page-stage';
    stage.style.width = canvas.width + 'px';
    stage.style.height = canvas.height + 'px';
    stage.appendChild(canvas);
    holder.appendChild(stage);
    const eff = effectiveFor(key);
    if (eff) {
      const img = document.createElement('img');
      img.src = state.watermark.dataUrl;
      img.style.position = 'absolute';
      img.style.opacity = String(state.global.opacity);
      const w = eff.wFrac * canvas.width;
      img.style.left = (eff.xFrac * canvas.width) + 'px';
      img.style.top = (eff.yFrac * canvas.height) + 'px';
      img.style.width = w + 'px';
      img.style.height = (w / state.watermark.aspect) + 'px';
      stage.appendChild(img);
    }
  };
  thumbObserver.observe(card);
}

async function openEditor(idx) {
  const pg = state.pages[idx];
  const key = `${pg.fileIndex}:${pg.pageIndex}`;
  const ed = document.getElementById('editor');
  document.getElementById('grid').hidden = true;
  ed.hidden = false;
  ed.innerHTML = `<div style="margin-bottom:10px">
      <button id="ed-back">← All pages</button>
      <button id="ed-delete">Delete watermark on this page</button>
      <button id="ed-reset">Reset to default</button>
      <span style="color:#8a8f98;margin-left:8px">file ${pg.fileIndex + 1}, page ${pg.pageIndex + 1}</span>
    </div><div id="ed-stage"></div>`;

  const host = document.getElementById('ed-stage');
  host.textContent = 'Rendering…';
  const { canvas } = await renderPage(state.files[pg.fileIndex], pg.pageIndex + 1, 700);
  host.innerHTML = '';
  const stage = document.createElement('div');
  stage.className = 'page-stage';
  stage.style.width = canvas.width + 'px';
  stage.style.height = canvas.height + 'px';
  stage.appendChild(canvas);
  host.appendChild(stage);

  const eff = effectiveFor(key);
  let box = null;
  if (eff) {
    box = createWatermarkBox(stage, {
      dataUrl: state.watermark.dataUrl, aspect: state.watermark.aspect,
      opacity: state.global.opacity, placement: eff,
      onChange: (p) => { state.overrides[key] = { xFrac: p.xFrac, yFrac: p.yFrac, wFrac: p.wFrac }; }
    });
  }

  document.getElementById('ed-back').onclick = () => {
    document.getElementById('grid').hidden = false;
    ed.hidden = true;
    enterReview();
  };
  document.getElementById('ed-delete').onclick = () => {
    state.overrides[key] = { deleted: true };
    if (box) { box.destroy(); box = null; }
  };
  document.getElementById('ed-reset').onclick = () => {
    delete state.overrides[key];
    openEditor(idx); // re-render with global placement
  };
}

// ---------- Screen 5: save ----------
function enterSave() {
  document.getElementById('summary').innerHTML = '';
  document.getElementById('progress').innerHTML = '';
  document.getElementById('out-path').textContent = state.outputDir || '';
  renderSaveNav();
}

function renderSaveNav() {
  // Save button lives in the footer for step 5.
  const disabled = state.outputDir ? '' : 'disabled';
  document.getElementById('nav').innerHTML =
    `<button id="back">Back</button>
     <button id="save" class="primary" ${disabled}>Save watermarked PDFs</button>`;
  document.getElementById('back').onclick = () => window.__nav.show(4);
  document.getElementById('save').onclick = doSave;
}

document.getElementById('choose-out').onclick = async () => {
  const dir = await window.api.selectOutputDir();
  if (dir) { state.outputDir = dir; document.getElementById('out-path').textContent = dir; renderSaveNav(); }
};

window.api.onProgress((p) => {
  document.getElementById('progress').textContent =
    `Watermarking ${p.fileName}: page ${p.page + 1} / ${p.totalPages}`;
});

async function doSave() {
  document.getElementById('save').disabled = true;
  const job = {
    files: state.files,
    watermark: { dataUrl: state.watermark.dataUrl, isPng: state.watermark.isPng, aspect: state.watermark.aspect },
    global: state.global,
    overrides: state.overrides,
    outputDir: state.outputDir
  };
  const { results } = await window.api.generate(job);
  document.getElementById('progress').textContent = 'Done.';
  const ok = results.filter((r) => r.status === 'ok').length;
  const rows = results.map((r) =>
    `<div class="file-row"><span>${r.file}</span><span>${r.status}${r.reason ? ': ' + r.reason : ''}</span></div>`
  ).join('');
  document.getElementById('summary').innerHTML =
    `<p>${ok} of ${results.length} files written to ${state.outputDir}.</p>${rows}
     <button id="open-out" class="primary">Open output folder</button>`;
  document.getElementById('open-out').onclick = () => window.api.openFolder(state.outputDir);
}
```

Then move the final `show(1);` call to the very end of the file (after all appended code).

- [ ] **Step 2: Add thumbnail styles to `src/renderer/styles.css`**

```css
.thumb { width: 210px; background: #fff; border: 1px solid #e2e4e8; border-radius: 8px; padding: 6px; cursor: pointer; }
.thumb:hover { border-color: #2563eb; }
.thumb-canvas { min-height: 120px; display: flex; align-items: center; justify-content: center; }
.thumb-label { font-size: 12px; color: #555; text-align: center; margin-top: 4px; }
#editor button { margin-right: 8px; }
```

- [ ] **Step 3: Full manual walkthrough (still without background removal)**

Run: `npm start`
- Screen 1: add 2 PDFs (ideally mixed page sizes / multi-page). Next.
- Screen 2: choose a `.jpg`, set opacity ~40%. Next.
- Screen 3: drag the watermark; resize via the corner handle (stays proportional). Next.
- Screen 4: thumbnails render for all pages of both files with the watermark; click one → move it, resize it, click "Delete watermark on this page" (watermark disappears), go back → that thumbnail shows no watermark; open another → "Reset to default" restores global. Next.
- Screen 5: choose an output folder → Save. Progress shows; summary lists files as `ok`; "Open output folder" opens Explorer. Open a written PDF and confirm the watermark on all pages except the deleted one, with the correct position/size/opacity.

Close the window.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/app.js src/renderer/styles.css
git commit -m "feat: position, review (per-page overrides), and save screens"
```

---

## Task 10: Fetch the AI model and verify background removal end-to-end

**Files:**
- Adds: `assets/models/u2net.onnx` (on disk; gitignored)
- Modify: `.gitignore`

- [ ] **Step 1: Ignore the model and dist in git**

Append to `.gitignore`:

```
node_modules/
dist/
assets/models/*.onnx
```

- [ ] **Step 2: Download the model (requires internet — build-time only)**

Run: `npm run fetch-model`
Expected: `assets/models/u2net.onnx` created (~168 MB). If the URL is unreachable, download `u2net.onnx` from the rembg project's model releases manually and place it at that exact path. (Smaller alternative: `u2netp.onnx` renamed to `u2net.onnx` — same preprocessing, lower quality, ~5 MB.)

- [ ] **Step 3: Verify availability and inference**

Run: `npm start`
- On Screen 2, after choosing a `.jpg`, the "Remove background (local AI)" checkbox is now enabled.
- Check it → note shows "processing…" then "done"; the preview shows the subject on the checkerboard (transparent) background.
- Proceed through Save and confirm the output PDF shows the watermark with its background removed.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore bundled model and dist artifacts"
```

---

## Task 11: Package as a portable `.exe`

**Files:**
- Modify: `package.json` (electron-builder `build` block)
- Create: `assets/icon.ico` (optional; skip `icon` line if not provided)

- [ ] **Step 1: Add the `build` block to `package.json`** (top-level key, sibling of `scripts`)

```json
"build": {
  "appId": "com.local.pdfwatermark",
  "productName": "PDF Watermark Tool",
  "directories": { "output": "dist" },
  "files": [
    "src/**/*",
    "assets/models/**/*",
    "package.json"
  ],
  "asarUnpack": [
    "**/node_modules/onnxruntime-node/**",
    "assets/models/**"
  ],
  "win": {
    "target": "portable",
    "icon": "assets/icon.ico"
  },
  "portable": {
    "artifactName": "PDF-Watermark-Tool.exe"
  }
}
```

If you have no `assets/icon.ico`, remove the `"icon": "assets/icon.ico"` line (electron-builder will use the default Electron icon).

- [ ] **Step 2: Build the portable exe**

Run: `npm run dist`
Expected: `dist/PDF-Watermark-Tool.exe` is produced (large, ~150–250 MB). electron-builder prints the output path.

- [ ] **Step 3: Run the packaged exe**

Double-click `dist/PDF-Watermark-Tool.exe` (or run it from a terminal). Expected: the app launches with no install step. Run the full wizard on real files (including background removal) and confirm output PDFs are correct.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "build: electron-builder portable Windows target"
```

---

## Task 12: Offline verification + README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Verify true offline operation**

Disconnect from the network (disable Wi-Fi / pull the cable), then run `dist/PDF-Watermark-Tool.exe`. Complete a full run including background removal and Save. Expected: everything works with no connectivity. The CSP in `index.html` already blocks remote loads; confirm DevTools shows no failed network requests during a run.

- [ ] **Step 2: Write `README.md`**

```markdown
# PDF Watermark Tool

A fully-offline Windows desktop app that adds a `.jpg` watermark to every page of one or
more PDF files.

## Use
1. Add one or more PDFs.
2. Choose a `.jpg` watermark. Optionally remove its background (local AI) and set opacity.
3. Position and size the watermark on page 1 — this applies to every page of every file.
4. Review all pages; move/resize or delete the watermark on individual pages.
5. Choose an output folder and save. Originals are never modified.

## Develop
- `npm install`
- `npm run fetch-model`  # one-time; downloads the background-removal model (build-time only)
- `npm start`            # run in dev
- `npm test`             # unit + integration tests
- `npm run dist`         # build dist/PDF-Watermark-Tool.exe (portable)

## Notes
- Runs with zero network access. The AI model is bundled locally.
- Background removal requires `assets/models/u2net.onnx` to be present at build time.
```

- [ ] **Step 3: Final full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README and offline verification"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** multi-file add + remove (Task 8), shared watermark w/ opacity + local-AI background removal (Tasks 4, 8, 10), position/size on page 1 (Task 9/Screen 3), all-pages preview with per-page move/resize/delete (Task 9/Screen 4), choose-output-folder save with collision-safe names and untouched originals (Tasks 5, 9), fraction→points math with origin flip (Task 2), portable exe (Task 11), fully offline (CSP + bundled model, Task 12). All spec sections map to tasks.
- **Type consistency:** `resolveEffective` / `fractionToPdfRect` / `nextAvailableName` signatures match between Task 2, Task 3, and Task 5. `Watermark` uses `{ dataUrl, isPng, aspect }` consistently across Screen 2 (Task 8), the `Job` (Task 9), and `generate` (Task 5). `pageKey` is `${fileIndex}:${pageIndex}`, 0-based, everywhere.
- **Placeholders:** none — every code step is complete. The only deliberately manual artifact is the model binary (Task 10), which the app gracefully handles when absent.
