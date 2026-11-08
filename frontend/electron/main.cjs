const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');

let museProcess = null;

function startMuseGateway() {
  const isDev = !app.isPackaged;
  const exePath = isDev
    ? path.join(__dirname, '../resources/bin/muse-engine.exe')
    : path.join(process.resourcesPath, 'bin/muse-engine.exe');

  museProcess = spawn(exePath, [], {
    windowsHide: true,
    env: {
      ...process.env,
      MUSE2API_HOST: '127.0.0.1',
      MUSE2API_PORT: '18610',
      MUSE2API_DRIVER: 'browser',
      MUSE2API_API_KEY: 'm2a_secret_key',
    },
  });
}

function killMuseGateway() {
  if (museProcess && museProcess.pid) {
    exec(`taskkill /pid ${museProcess.pid} /T /F`);
    museProcess = null;
  }
}

app.whenReady().then(() => {
  startMuseGateway();

  const win = new BrowserWindow({
    width: 1400,
    height: 880,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  if (!app.isPackaged) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
});

app.on('window-all-closed', () => {
  killMuseGateway();
  app.quit();
});
