const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  
  // Update events
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, message) => callback(message)),
  onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (event, percent) => callback(percent)),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, available) => callback(available))
});
