const { app, BrowserWindow, ipcMain, desktopCapturer, session, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

let mainWindow;
let updateWindow;

// Configure auto-updater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function createUpdateWindow() {
  updateWindow = new BrowserWindow({
    width: 400,
    height: 200,
    frame: false,
    resizable: false,
    center: true,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  updateWindow.loadFile(path.join(__dirname, '../renderer/update.html'));
}

function createWindow() {
  // Remove the menu bar
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    frame: true,
    backgroundColor: '#1a1a2e',
    show: false // Don't show until update check is complete
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Open DevTools in development
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Auto-updater events
autoUpdater.on('checking-for-update', () => {
  console.log('Checking for updates...');
  if (updateWindow) {
    updateWindow.webContents.send('update-status', 'Checking for updates...');
  }
});

autoUpdater.on('update-available', (info) => {
  console.log('Update available:', info.version);
  if (updateWindow) {
    updateWindow.webContents.send('update-status', `Update available: v${info.version}`);
    updateWindow.webContents.send('update-available', true);
  }
});

autoUpdater.on('update-not-available', () => {
  console.log('No updates available');
  // Close update window and show main window
  if (updateWindow) {
    updateWindow.close();
    updateWindow = null;
  }
  if (mainWindow) {
    mainWindow.show();
  }
});

autoUpdater.on('download-progress', (progress) => {
  console.log('Download progress:', progress.percent);
  if (updateWindow) {
    updateWindow.webContents.send('update-progress', Math.round(progress.percent));
  }
});

autoUpdater.on('update-downloaded', () => {
  console.log('Update downloaded, will install on restart');
  if (updateWindow) {
    updateWindow.webContents.send('update-status', 'Update downloaded! Restarting...');
  }
  // Quit and install after a short delay
  setTimeout(() => {
    autoUpdater.quitAndInstall(false, true);
  }, 1500);
});

autoUpdater.on('error', (error) => {
  console.error('Update error:', error);
  // If update check fails, still show the app
  if (updateWindow) {
    updateWindow.close();
    updateWindow = null;
  }
  if (mainWindow) {
    mainWindow.show();
  }
});

// Handle screen source picker
ipcMain.handle('get-screen-sources', async () => {
  const sources = await desktopCapturer.getSources({ 
    types: ['screen', 'window'],
    thumbnailSize: { width: 150, height: 150 }
  });
  return sources.map(source => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL()
  }));
});

app.whenReady().then(() => {
  createWindow();
  createUpdateWindow();
  
  // Check for updates (only in production)
  if (app.isPackaged) {
    autoUpdater.checkForUpdates();
  } else {
    // In development, skip update check and show main window
    if (updateWindow) {
      updateWindow.close();
      updateWindow = null;
    }
    mainWindow.show();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Handle any IPC messages if needed
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});
