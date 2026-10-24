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
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  aiConfigure: (patch) => ipcRenderer.invoke('ai:configure', patch),
  aiSetKey: (provider, key) => ipcRenderer.invoke('ai:setKey', provider, key),
  aiModels: (provider) => ipcRenderer.invoke('ai:models', provider),
  aiRun: (id, req) => ipcRenderer.invoke('ai:run', id, req),
  aiStop: (id) => ipcRenderer.invoke('ai:stop', id),
  onAi: (cb) => {
    const channels = ['ai:start', 'ai:token', 'ai:done', 'ai:error'];
    const handlers = channels.map((ch) => {
      const h = (_e, payload) => cb(ch.slice(3), payload);
      ipcRenderer.on(ch, h);
      return [ch, h];
    });
    return () => handlers.forEach(([ch, h]) => ipcRenderer.removeListener(ch, h));
  },
  onNotesChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('notes:changed', handler);
    return () => ipcRenderer.removeListener('notes:changed', handler);
  },
});
