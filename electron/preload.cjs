const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apex', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximizeToggle: () => ipcRenderer.invoke('window:maximize-toggle'),
  close: () => ipcRenderer.invoke('window:close'),
  getBounds: () => ipcRenderer.invoke('window:get-bounds'),
  setBounds: (bounds) => ipcRenderer.invoke('window:set-bounds', bounds),
  getMinimumSize: () => ipcRenderer.invoke('window:get-minimum-size'),
  setMinimumSize: (size) => ipcRenderer.invoke('window:set-minimum-size', size),
});
