const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pyramid', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickFolder: () => ipcRenderer.invoke('settings:pickFolder'),
  listNotes: () => ipcRenderer.invoke('notes:list'),
  readNote: (rel) => ipcRenderer.invoke('notes:read', rel),
  saveNote: (rel, body) => ipcRenderer.invoke('notes:save', rel, body),
  createNote: (notebook) => ipcRenderer.invoke('notes:create', notebook),
  removeNote: (rel) => ipcRenderer.invoke('notes:remove', rel),
  onNotesChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('notes:changed', handler);
    return () => ipcRenderer.removeListener('notes:changed', handler);
  },
});
