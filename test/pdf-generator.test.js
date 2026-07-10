const { test } = require('node:test');
const assert = require('node:assert');
const { PDFDocument, PDFName, rgb } = require('pdf-lib');
const { watermarkDocument } = require('../src/main/pdf-generator');

// 1x1 red PNG (opaque), base64.
const RED_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Number of image XObjects actually placed on a page. pdf-lib may leave an EMPTY
// XObject dict on a page that was skipped, so we count entries, not dict presence.
function imageCount(page) {
  const xobjs = page.node.Resources()?.lookup(PDFName.of('XObject'));
  return xobjs ? xobjs.keys().length : 0;
}

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
  // Each page should now have exactly one image drawn.
  for (const page of reloaded.getPages()) {
    assert.strictEqual(imageCount(page), 1, 'expected one image on the page');
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
  assert.strictEqual(imageCount(reloaded.getPage(0)), 1, 'page 0 should be watermarked');
  assert.strictEqual(imageCount(reloaded.getPage(1)), 0, 'page 1 should have no watermark');
});
