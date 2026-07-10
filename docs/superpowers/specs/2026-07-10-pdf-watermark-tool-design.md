# PDF Watermark Tool — Design Spec

**Date:** 2026-07-10
**Status:** Approved (pending spec review)

## 1. Summary

A local Windows desktop application that stamps a `.jpg` image watermark onto every
page of one or more PDF documents. Packaged with Electron as a **portable single
`.exe`** that runs with no installation. The app runs **fully offline** — no network
access at any point, including the AI background-removal step.

The user drives a 5-screen wizard: pick PDFs → pick the watermark image (with optional
local-AI background removal + opacity) → set the watermark's position/size on page 1 →
review all pages and adjust or delete the watermark per page → choose an output folder
and save.

## 2. Goals

- Add a single, shared `.jpg` watermark to all pages of one or more PDFs.
- Set watermark position and size visually, once, applied to every page of every file.
- Review every page and override (move/resize) or delete the watermark on individual
  pages.
- Optionally remove the watermark image's background using a **local** AI model
  (no internet), producing a transparent watermark.
- Control watermark opacity.
- Write results as new files into a chosen output folder; never modify originals.
- Ship as one portable `.exe`; run with zero network connectivity.

## 3. Non-Goals (YAGNI)

- No text watermarks (image only).
- No per-file separate placement flows — one global placement, with per-page overrides.
- No PDF editing beyond watermarking (no page reorder, merge, split, etc.).
- No installer, auto-update, telemetry, or any online feature.
- No batch presets / saved configurations across runs.
- No image formats other than `.jpg`/`.jpeg` for the watermark input.

## 4. User Flow (Wizard Screens)

### Screen 1 — Select PDFs
- "Add PDFs" button opens a multi-select file dialog (`.pdf`).
- Selected files listed with name; each row has a **Remove** button.
- Can add more via the button (appends). Duplicate paths ignored.
- **Next** enabled only when ≥1 PDF is selected.

### Screen 2 — Select Watermark
- "Choose image" button opens a file dialog filtered to `.jpg`/`.jpeg`.
- Shows a preview of the chosen image.
- **Remove background (local AI)** toggle:
  - When enabled, runs the bundled local model on the image and shows a before/after
    preview. Produces a transparent PNG that becomes the watermark used everywhere.
  - When disabled, the original JPG is used as the watermark.
  - Toggling re-processes (result cached per image so re-toggling is instant).
- **Opacity** slider, 0–100%, default 50%. Live-previewed here and on later screens.
- **Next** enabled only when a watermark image is selected (and, if background removal
  is toggled on, processing has completed successfully).

### Screen 3 — Position & Size
- Renders **page 1 of the first PDF** at a comfortable size (fit-to-view) via pdf.js.
- The processed watermark is overlaid as a draggable/resizable element:
  - **Drag body** to move.
  - **Drag a corner handle** to resize; **aspect ratio locked** to the image's
    natural ratio.
  - Watermark rendered at the current opacity.
- Placement here defines the **global placement** applied to every page of every file.
- Sensible initial placement (e.g. centered, ~30% of page width).
- **Back / Next.**

### Screen 4 — All-Pages Preview
- Scrollable grid of thumbnails for **every page of every file** (rendered via pdf.js at
  a lower scale), each showing the watermark at that page's effective placement.
- Selecting a page opens it enlarged for editing:
  - **Move / resize** (aspect locked) → stores a per-page override.
  - **Delete** button → marks the watermark removed for that page only.
  - **Reset to default** → clears the page's override, reverting to global placement.
- Pages without overrides continue to reflect the global placement live (if the user
  goes Back and changes the global placement, non-overridden pages update).
- **Back / Next.**

### Screen 5 — Save
- "Choose output folder" button (folder dialog). Selected path shown.
- **Save** writes each input PDF, watermarked per the effective placement of each page,
  into the output folder using the original filename.
  - If a target filename already exists in the output folder, auto-suffix
    ` (1)`, ` (2)`, … to avoid clobbering.
- Progress bar with current file / page counts.
- On completion: summary (N files written, output folder) with a button to open the
  output folder in Explorer. Originals are never modified.

## 5. Architecture

Electron app with three roles and strict context isolation. **No network permitted.**

### Renderer (UI)
- Vanilla HTML/CSS/JS wizard (no bundler/build step).
- pdf.js renders page previews (full page on Screen 3, thumbnails on Screen 4) to canvas,
  fully offline (worker bundled locally).
- Watermark overlay is an absolutely-positioned `<img>` with pointer-event
  drag/resize handles; math kept in fraction space.
- Holds all wizard state (see Data Model).

### Main (Node)
- Native file/folder dialogs (`dialog.showOpenDialog`).
- **Background removal**: `onnxruntime-node` running a bundled segmentation model
  (U²-Net / ISNet class). Input JPG → alpha mask → transparent PNG buffer.
- **PDF generation**: `pdf-lib`. Embeds the watermark image and draws it on each page at
  the computed rectangle and opacity, then writes the output file.
- Reads input PDFs and writes outputs to disk.

### Preload (bridge)
`contextBridge` exposes a minimal, explicit API; `contextIsolation: true`,
`nodeIntegration: false`, `sandbox` where compatible:
- `selectPdfs() → string[]`
- `selectWatermark() → { path, dataUrl, width, height }`
- `removeBackground(imagePath) → { dataUrl, width, height }` (transparent PNG)
- `selectOutputDir() → string`
- `generate(job) → progress events + final result`
- `renderPdfPage` support: input PDFs are read in main and page bytes/handles provided to
  the renderer for pdf.js, OR pdf.js reads file paths directly via `file://` — chosen
  during implementation, whichever keeps context isolation cleanest.

### Offline guarantee
- No remote URLs anywhere; all assets (pdf.js worker, model files, fonts) bundled.
- The AI model is loaded from a bundled local path. We verify no outbound requests
  (e.g., block/observe the session's network) so it is provably offline.

## 6. Data Model

Placement is stored in **fraction-of-page** units so one placement maps onto pages of
differing dimensions.

```
GlobalPlacement = {
  xFrac, yFrac,      // top-left of watermark, as fraction of page width/height
  wFrac,             // width as fraction of page width
  // height derived: hFrac = wFrac * pageWidthPts / pageHeightPts / imageAspect
  //   (kept consistent so the on-screen aspect ratio matches the natural image ratio)
  opacity            // 0..1
}

Watermark = {
  originalPath,
  useRemovedBackground: bool,
  imageDataUrl,      // processed image actually used (JPG or transparent PNG)
  naturalAspect      // width/height of the processed image
}

PageKey = `${fileIndex}:${pageIndex}`
Override = { xFrac, yFrac, wFrac } | { deleted: true }
overrides: Map<PageKey, Override>

Job = { files: string[], watermark, global: GlobalPlacement, overrides, outputDir }
```

**Effective placement (per page):** if `overrides[key]` is `deleted` → no watermark;
else if an override exists → use it; else → use `global`. Opacity comes from the
watermark/global settings (single opacity value for the run).

**Coordinate conversion (fraction → PDF points), per page:**
Given page size `(Wpts, Hpts)` and placement `(xFrac, yFrac, wFrac)`:
- `wPts = wFrac * Wpts`
- `hPts = wPts / naturalAspect`
- `xPts = xFrac * Wpts`
- pdf-lib origin is bottom-left, so `yPts = Hpts - (yFrac * Hpts) - hPts`
- Draw with `opacity`.

Watermark aspect uses the processed image's pixel dimensions.

## 7. Error Handling

- **Corrupt/unreadable PDF**: skip with a clear per-file error in the Save summary;
  continue with the rest. Surface early on load if a file can't be opened at all.
- **Encrypted/password PDF**: detected on load; shown as unsupported for that file
  (skipped at save with a reason). No password prompt in v1.
- **Non-JPG watermark chosen**: dialog filter prevents it; defensive check rejects
  otherwise.
- **Background removal failure/timeout**: show an error, keep the toggle off, allow
  proceeding with the plain JPG.
- **Output folder not writable / disk full**: report per-file failure in the summary;
  do not crash.
- **Filename collision**: auto-suffix ` (n)`.
- **Zero pages / empty PDF**: skip with a reason.
- Any uncaught error in main is caught and reported to the UI rather than crashing.

## 8. Testing

- **Unit (main-process pure logic):**
  - Fraction→points conversion incl. the bottom-left origin flip, across landscape and
    portrait page sizes and non-1:1 image aspect ratios.
  - Effective-placement resolution: global vs. override vs. deleted.
  - Output filename collision suffixing.
- **Integration:**
  - Generate a watermarked PDF from a fixture PDF + fixture image; re-open with pdf-lib
    and assert an image XObject exists on each expected page and is absent on deleted
    pages.
- **Manual E2E:** run the packaged app, watermark a real multi-file batch (mixed page
  sizes), toggle background removal, delete/override some pages, save, and visually
  confirm the output PDFs.
- **Offline check:** run with networking disabled and confirm full functionality,
  including background removal.

## 9. Packaging

- **electron-builder**, target **portable** (Windows, x64) → a single self-contained
  `.exe` requiring no installation.
- Bundled assets: pdf.js + worker, the ONNX model file(s), onnxruntime-node native
  binaries, app HTML/CSS/JS.
- Expected size ~150–250 MB, dominated by Electron + the AI model. Accepted tradeoff for
  offline background removal.
- `npm run dist` produces the `.exe` under `dist/`.

## 10. Key Risks / Open Items (to resolve in implementation)

- **Model selection & bundling**: confirm a permissively-licensed segmentation model
  that runs on `onnxruntime-node` CPU, produces good alpha for typical logos/photos, and
  bundles cleanly into the portable exe. Verify offline load path.
- **pdf.js in a context-isolated renderer**: settle how input PDF bytes reach the
  renderer (path via `file://` vs. bytes over IPC) without weakening isolation.
- **Performance** on large batches / high page counts: thumbnail rendering should be
  lazy/virtualized if a batch is big; background removal runs once per image, not per
  page.
