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
