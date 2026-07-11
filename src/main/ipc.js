'use strict';
const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const { watermarkDocument } = require('./pdf-generator');
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

  ipcMain.handle('basename', async (_e, p) => path.basename(p));

  ipcMain.handle('select-save-path', async (_e, originalFilePath) => {
    const dir = path.dirname(originalFilePath);
    const ext = path.extname(originalFilePath);
    const base = path.basename(originalFilePath, ext);
    const suggested = path.join(dir, `${base}_watermarked${ext}`);
    const r = await dialog.showSaveDialog({
      title: 'Save watermarked PDF',
      defaultPath: suggested,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    return r.canceled ? null : r.filePath;
  });

  ipcMain.handle('save-one', async (event, job) => {
    const b64 = job.watermark.dataUrl.split(',')[1];
    const image = {
      bytes: Buffer.from(b64, 'base64'),
      isPng: job.watermark.isPng,
      aspect: job.watermark.aspect
    };
    try {
      const pdfBytes = await fs.promises.readFile(job.file);
      const out = await watermarkDocument({
        pdfBytes, image,
        global: job.global,
        overrides: job.overrides,
        fileIndex: 0,
        onPage: (page, totalPages) =>
          event.sender.send('save-progress', { page, totalPages })
      });
      await fs.promises.writeFile(job.outputPath, out);
      return { status: 'ok', output: job.outputPath };
    } catch (err) {
      return { status: 'error', reason: err.message };
    }
  });
}

module.exports = { registerIpc };
