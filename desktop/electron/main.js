const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require('electron');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { Notes } = require('./notes');
const { Ai } = require('./ai');
const { SyncManager } = require('./sync/manager');
const phoneix = require('./phoneix');

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

  const ai = new Ai({
    dir: app.getPath('userData'),
    safeStorage,
    readNote: (rel) => notes.read(rel),
    getConfig: () => readSettings().ai,
    setConfig: (cfg) => writeSettings({ ai: cfg }),
  });
  const send = (channel, payload) => { if (!win.isDestroyed()) win.webContents.send(channel, payload); };

  // Wi-Fi sync with the phone. The listener only runs when the user switched it on (or is pairing).
  const sealKey = (plain) => (safeStorage.isEncryptionAvailable() ? `enc:${safeStorage.encryptString(plain).toString('base64')}` : `raw:${plain}`);
  const openKey = (stored) => (stored.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64')) : stored.slice(4));
  const sync = new SyncManager({
    getNotesDir: () => readSettings().notesDir,
    dataDir: app.getPath('userData'),
    protect: sealKey,
    unprotect: openKey,
    trash: (full) => shell.trashItem(full),
    pcName: os.hostname(),
    getLang: () => readSettings().lang,
    isLiveEnabled: () => !!readSettings().liveTyping,
    onChange: (e) => (e.kind === 'live' ? send('live:changed', e) : send('sync:changed', e)),
  });
  if (readSettings().syncEnabled) sync.start().catch(() => {});
  app.on('before-quit', () => sync.stop());

  const phoneixInfo = () => phoneix.publicInfo(phoneix.readInfo());

  ipcMain.handle('sync:status', reply(() => ({ ...sync.status(), enabled: !!readSettings().syncEnabled, phoneix: phoneixInfo() })));
  ipcMain.handle('sync:setEnabled', reply(async (on) => {
    writeSettings({ syncEnabled: !!on });
    await sync.setEnabled(!!on);
  }));
  ipcMain.handle('sync:startPairing', reply(async () => {
    writeSettings({ syncEnabled: true });
    const { deviceId, qr } = await sync.startPairing(); // the link itself (it carries the key) stays in the main process
    return { deviceId, qr };
  }));
  // Letter-by-letter typing: this window is a client of the same live notes the phone talks to.
  ipcMain.handle('live:call', reply((req) => sync.live.handle(req)));
  ipcMain.handle('live:flush', reply((id) => sync.live.flush(id ? String(id) : undefined)));
  // "Sync with Phoneix": the pairing link travels over Phoneix's existing connection to the phone (no QR code).
  ipcMain.handle('sync:pairViaPhoneix', reply(async () => {
    const info = phoneix.readInfo();
    if (!info.found || !info.running) throw new Error('PHONEIX_DOWN');
    if (!info.paired) throw new Error('PHONEIX_UNPAIRED');
    writeSettings({ syncEnabled: true });
    const { deviceId, payload } = await sync.startPairing();
    try {
      await phoneix.sendPairLink(info, payload);
    } catch (err) {
      sync.cancelPairing();
      throw err;
    }
    return { deviceId, via: true };
  }));
  ipcMain.handle('sync:cancelPairing', reply(() => sync.cancelPairing()));
  ipcMain.handle('sync:removeDevice', reply((id) => sync.removeDevice(String(id))));
  ipcMain.handle('sync:resolve', reply((copyId, choice) => sync.resolveConflict(String(copyId), String(choice))));

  ipcMain.handle('ai:status', reply(() => ai.status()));
  ipcMain.handle('ai:configure', reply((patch) => ai.setConfigPatch(patch)));
  ipcMain.handle('ai:setKey', reply((provider, key) => { ai.setKey(provider, String(key || '')); return ai.status(); }));
  ipcMain.handle('ai:models', reply((provider) => ai.models(provider)));
  ipcMain.handle('ai:run', reply((id, req) => ai.run(String(id), req, send)));
  ipcMain.handle('ai:stop', reply((id) => ai.stop(String(id))));

  ipcMain.handle('notes:list', reply(() => notes.list()));
  ipcMain.handle('notes:read', reply((rel) => notes.read(rel)));
  ipcMain.handle('notes:save', reply((rel, body) => notes.save(rel, body)));
  ipcMain.handle('notes:create', reply((notebook) => notes.create(notebook)));
  ipcMain.handle('notes:remove', reply((rel) => notes.remove(rel)));
});

app.on('window-all-closed', () => app.quit());
