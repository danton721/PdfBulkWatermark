'use strict';
const { ipcMain, dialog, shell } = require('electron');
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
