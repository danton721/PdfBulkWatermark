const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectPdfs: () => ipcRenderer.invoke('select-pdfs'),
  selectWatermark: () => ipcRenderer.invoke('select-watermark'),
  isModelAvailable: () => ipcRenderer.invoke('is-model-available'),
  removeBackground: (p) => ipcRenderer.invoke('remove-background', p),
  readPdf: (p) => ipcRenderer.invoke('read-pdf', p),
  basename: (p) => ipcRenderer.invoke('basename', p),
  selectSavePath: (originalFilePath) => ipcRenderer.invoke('select-save-path', originalFilePath),
  saveOne: (job) => ipcRenderer.invoke('save-one', job),
  onProgress: (cb) => ipcRenderer.on('save-progress', (_e, data) => cb(data))
});
