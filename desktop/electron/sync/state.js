const fs = require('fs');
const path = require('path');

// Paired devices and, per device, what both sides agreed on at the last sync (the engine's `base`).
// Lives in the app's data folder, not in the notes folder.
//
//   { devices: { <deviceId>: { name, key: <string from protect()>, pending: bool, base: {...} } } }
//
// `protect` / `unprotect` wrap the key (the app passes Electron safeStorage); tests use the identity.
class SyncState {
  constructor(file, { protect = (s) => s, unprotect = (s) => s } = {}) {
    this.file = file;
    this.protect = protect;
    this.unprotect = unprotect;
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      this.data = { devices: {} };
    }
    this.data.devices ||= {};
    this.data.conflicts ||= [];
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  addPending(id, name, key) {
    this.data.devices[id] = { name, key: this.protect(key.toString('base64')), pending: true, base: {} };
    this.save();
  }

  // A scan that never finishes must not break an existing pairing, so a new key stays pending until it is used once.
  confirm(id) {
    const d = this.data.devices[id];
    if (d && d.pending) {
      d.pending = false;
      this.save();
    }
  }

  device(id) {
    const d = this.data.devices[id];
    if (!d) return null;
    return { id, name: d.name, pending: d.pending, key: Buffer.from(this.unprotect(d.key), 'base64'), base: d.base || {} };
  }

  list() {
    return Object.entries(this.data.devices).map(([id, d]) => ({ id, name: d.name, pending: d.pending, lastSync: d.lastSync || null }));
  }

  setName(id, name) {
    const d = this.data.devices[id];
    const clean = String(name || '').replace(/[\r\n]/g, ' ').trim().slice(0, 60);
    if (d && clean && d.name !== clean) {
      d.name = clean;
      this.save();
    }
  }

  setLastSync(id, iso) {
    if (this.data.devices[id]) {
      this.data.devices[id].lastSync = iso;
      this.save();
    }
  }

  // A conflict stays open until the user picks what to do with the two versions (see manager.resolveConflict).
  addConflict(c) {
    this.data.conflicts.push({ ...c, open: true });
    this.save();
  }

  openConflicts() {
    return this.data.conflicts.filter((c) => c.open);
  }

  closeConflict(copyId) {
    for (const c of this.data.conflicts) if (c.copyId === copyId) c.open = false;
    this.data.conflicts = this.data.conflicts.filter((c) => c.open || Date.now() - Date.parse(c.at) < 30 * 86400_000);
    this.save();
  }

  setBase(id, base) {
    if (this.data.devices[id]) {
      this.data.devices[id].base = base;
      this.save();
    }
  }

  remove(id) {
    delete this.data.devices[id];
    this.save();
  }
}

module.exports = { SyncState };
