const { app, BrowserWindow, ipcMain, desktopCapturer, session, Menu, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

// Register custom protocol for auth callbacks
const PROTOCOL = 'toy';
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

let mainWindow;
let updateWindow;
let isInitialCheck = true; // Track if this is the initial update check on launch
let backgroundUpdateAvailable = false;
let authCallbackUrl = null; // Store auth callback URL

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
  
  if (isInitialCheck) {
    // First launch - show update window and download
    if (updateWindow) {
      updateWindow.webContents.send('update-status', `Update available: v${info.version}`);
      updateWindow.webContents.send('update-available', true);
    }
  } else {
    // Background check while app is running - show dialog forcing restart
    backgroundUpdateAvailable = true;
    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: `A new version (v${info.version}) is available!`,
        detail: 'The app will restart to apply the update.',
        buttons: ['Restart Now'],
        defaultId: 0,
        noLink: true
      }).then(() => {
        // Force restart when update is downloaded
        autoUpdater.on('update-downloaded', () => {
          autoUpdater.quitAndInstall(false, true);
        });
      });
    }
  }
});

autoUpdater.on('update-not-available', () => {
  console.log('No updates available');
  
  if (isInitialCheck) {
    // First launch - close update window and show main window
    if (updateWindow) {
      updateWindow.close();
      updateWindow = null;
    }
    if (mainWindow) {
      mainWindow.show();
    }
    isInitialCheck = false;
  }
  // Background checks: no action needed if no update
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
    
    // Periodic background update check every 5 minutes
    setInterval(() => {
      isInitialCheck = false;
      if (!backgroundUpdateAvailable) {
        console.log('Background update check...');
        autoUpdater.checkForUpdates();
      }
    }, 5 * 60 * 1000); // 5 minutes
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
// Handle deep link on Windows/Linux (second instance)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    // Someone tried to run a second instance, we should focus our window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    
    // Handle the protocol URL (Windows/Linux)
    const url = commandLine.find(arg => arg.startsWith(`${PROTOCOL}://`));
    if (url) {
      handleAuthCallback(url);
    }
  });
}

// Handle deep link on macOS
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleAuthCallback(url);
});

// Process auth callback URL
function handleAuthCallback(url) {
  console.log('Auth callback received:', url);
  
  // Extract tokens from URL
  // URL format: toy://auth#access_token=xxx&refresh_token=xxx&...
  if (mainWindow) {
    mainWindow.webContents.send('auth-callback', url);
    mainWindow.show();
    mainWindow.focus();
  } else {
    // Store for later if window isn't ready yet
    authCallbackUrl = url;
  }
}

// Send stored auth callback when renderer is ready
ipcMain.handle('get-auth-callback', () => {
  const url = authCallbackUrl;
  authCallbackUrl = null;
  return url;
});