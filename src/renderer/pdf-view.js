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
