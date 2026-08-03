const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('node:path');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let mainWindow = null;
const DEFAULT_WINDOW_WIDTH = 1670;
const DEFAULT_WINDOW_HEIGHT = 945;
const DEFAULT_MIN_WIDTH = 640;
const DEFAULT_MIN_HEIGHT = 420;
const LOWEST_MIN_WIDTH = 640;
const LOWEST_MIN_HEIGHT = 420;

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
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: DEFAULT_MIN_WIDTH,
    minHeight: DEFAULT_MIN_HEIGHT,
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
      height: 820,
      minWidth: 420,
      minHeight: 420,
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
  const [minWidth, minHeight] = mainWindow.getMinimumSize();
  const next = {
    x: Number.isFinite(bounds.x) ? Math.round(bounds.x) : current.x,
    y: Number.isFinite(bounds.y) ? Math.round(bounds.y) : current.y,
    width: Number.isFinite(bounds.width) ? Math.max(minWidth, Math.round(bounds.width)) : current.width,
    height: Number.isFinite(bounds.height) ? Math.max(minHeight, Math.round(bounds.height)) : current.height,
  };
  mainWindow.setBounds(next, true);
  return mainWindow.getBounds();
});
ipcMain.handle('window:get-minimum-size', () => {
  if (!mainWindow) return null;
  const [width, height] = mainWindow.getMinimumSize();
  return { width, height };
});
ipcMain.handle('window:set-minimum-size', (_event, size = {}) => {
  if (!mainWindow) return null;
  const [currentWidth, currentHeight] = mainWindow.getMinimumSize();
  const width = Number.isFinite(size.width) ? Math.max(LOWEST_MIN_WIDTH, Math.round(size.width)) : currentWidth;
  const height = Number.isFinite(size.height) ? Math.max(LOWEST_MIN_HEIGHT, Math.round(size.height)) : currentHeight;
  mainWindow.setMinimumSize(width, height);
  const bounds = mainWindow.getBounds();
  if (bounds.width < width || bounds.height < height) {
    mainWindow.setBounds({ ...bounds, width: Math.max(bounds.width, width), height: Math.max(bounds.height, height) }, true);
  }
  return { width, height };
});
