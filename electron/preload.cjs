const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apex', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximizeToggle: () => ipcRenderer.invoke('window:maximize-toggle'),
  close: () => ipcRenderer.invoke('window:close'),
});
