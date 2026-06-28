const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('node:path');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let mainWindow = null;

if (process.platform === 'win32') {
  app.setAppUserModelId('com.apexfiles.desktop');
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
  process.exit(0);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 950,
    minWidth: 1460,
    minHeight: 920,
    title: 'Apex Files',
    frame: false,
    backgroundColor: '#090a0c',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  Menu.setApplicationMenu(null);

  mainWindow.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 560,
      height: 960,
      minWidth: 460,
      minHeight: 620,
      frame: true,
      autoHideMenuBar: true,
      backgroundColor: '#080d0f',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    },
  }));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'app-dist', 'index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize-toggle', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  }
  mainWindow.maximize();
  return true;
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:get-bounds', () => mainWindow?.getBounds() || null);
ipcMain.handle('window:set-bounds', (_event, bounds = {}) => {
  if (!mainWindow) return null;
  const current = mainWindow.getBounds();
  const next = {
    x: Number.isFinite(bounds.x) ? Math.round(bounds.x) : current.x,
    y: Number.isFinite(bounds.y) ? Math.round(bounds.y) : current.y,
    width: Number.isFinite(bounds.width) ? Math.max(900, Math.round(bounds.width)) : current.width,
    height: Number.isFinite(bounds.height) ? Math.max(700, Math.round(bounds.height)) : current.height,
  };
  mainWindow.setBounds(next, true);
  return mainWindow.getBounds();
});
