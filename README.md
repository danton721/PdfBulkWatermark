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
- Runs with zero network access. The AI model is bundled locally; the renderer's
  Content-Security-Policy is `connect-src 'self'`, so no remote connections are possible.
- Background removal requires `assets/models/u2netp.onnx` to be present at build time. If the
  model file is absent, the app still works — the "Remove background" option is simply
  disabled. `u2netp` (the lightweight U^2-Net variant, ~5MB) is used instead of the full
  `u2net` (~176MB) to keep the portable exe's per-launch extraction fast, at somewhat lower
  segmentation quality.
- The portable `.exe` needs no installation; double-click to run. Stock NSIS portable exes
  re-extract and delete their payload on every launch; `npm run dist` patches that template
  (`scripts/patch-portable-nsi.mjs`) so the payload is cached in `%TEMP%\pdf-watermark-tool`
  — the first launch extracts (showing a "Starting…" banner window), later launches skip
  extraction and start in a few seconds. Rebuilding the exe changes the payload hash, which
  invalidates the cache automatically; deleting the temp folder just triggers a re-extract.
- The build uses `compression: "store"` (no compression): a much larger exe, but the first
  launch skips LZMA decompression. Flip it back to `"maximum"` in package.json for a small
  exe at the cost of a slower first launch only (cached launches are unaffected).

## Project layout
- `src/main/` — Electron main process: window, IPC, PDF generation (pdf-lib), local AI
  background removal (onnxruntime-node + jimp), placement math.
- `src/preload/` — the context-isolated bridge exposing a minimal `window.api`.
- `src/renderer/` — the wizard UI (vanilla HTML/CSS/JS), pdf.js page rendering, and the
  draggable/resizable watermark overlay.
- `scripts/fetch-model.mjs` — one-time model download (the only code that touches the
  network, and it never runs inside the shipped app).
- `scripts/patch-portable-nsi.mjs` — build-time patch of electron-builder's portable NSIS
  template (extraction cache + "Starting…" banner); reapplied automatically by `npm run dist`.
- `test/` — Node `node:test` unit + integration tests.
