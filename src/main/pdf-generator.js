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
