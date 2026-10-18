'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// A deliberately small bridge: the renderer never receives Node or file paths
// it can subsequently use to read/write arbitrary files.
contextBridge.exposeInMainWorld('jscript', Object.freeze({
  platform: process.platform,
  openFile: () => ipcRenderer.invoke('jscript:open-file'),
  saveFile: (file) => ipcRenderer.invoke('jscript:save-file', file),
  loadAutosave: () => ipcRenderer.invoke('jscript:load-autosave'),
  saveAutosave: (state) => ipcRenderer.invoke('jscript:save-autosave', state),
  setDirty: (dirty) => ipcRenderer.invoke('jscript:set-dirty', dirty),
  exportPdf: (document) => ipcRenderer.invoke('jscript:export-pdf', document),
  printDocument: (document) => ipcRenderer.invoke('jscript:print-document', document),
}));
