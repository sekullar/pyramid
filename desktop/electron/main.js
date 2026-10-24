const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { Notes } = require('./notes');

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  const defaults = { lang: app.getLocale().startsWith('tr') ? 'tr' : 'en', notesDir: process.env.PYRAMID_NOTES_DIR || path.join(app.getPath('documents'), 'Pyramid') };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    return defaults;
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  return next;
}

const notes = new Notes(() => readSettings().notesDir);

// Same shape for every handler so the UI can show errors without try/catch everywhere.
const reply = (fn) => async (_event, ...args) => {
  try {
    return { ok: true, value: await fn(...args) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 480,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  return win;
}

// Tell the UI when files change on disk (edited elsewhere, or by sync later).
function watchNotes(win) {
  let timer = null;
  let watcher = null;
  const start = () => {
    if (watcher) watcher.close();
    try {
      notes.ensureDir();
      watcher = fs.watch(readSettings().notesDir, { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => win.webContents.send('notes:changed'), 250);
      });
    } catch {}
  };
  start();
  return start;
}

app.whenReady().then(() => {
  const win = createWindow();
  const restartWatch = watchNotes(win);

  ipcMain.handle('settings:get', () => readSettings());
  ipcMain.handle('settings:set', reply((patch) => {
    const next = writeSettings(patch);
    if (patch.notesDir) restartWatch();
    return next;
  }));
  ipcMain.handle('settings:pickFolder', reply(async () => {
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  }));

  ipcMain.handle('notes:list', reply(() => notes.list()));
  ipcMain.handle('notes:read', reply((rel) => notes.read(rel)));
  ipcMain.handle('notes:save', reply((rel, body) => notes.save(rel, body)));
  ipcMain.handle('notes:create', reply((notebook) => notes.create(notebook)));
  ipcMain.handle('notes:remove', reply((rel) => notes.remove(rel)));
});

app.on('window-all-closed', () => app.quit());
