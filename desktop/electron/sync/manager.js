const os = require('os');
const path = require('path');
const QRCode = require('qrcode');
const { SyncServer } = require('./server');
const { SyncState } = require('./state');
const { LiveHub } = require('./live');
const { Vault } = require('./vault');
const { restoreFromCopy, withBody, bodyOf } = require('./hash');

// Everything the app needs from sync, with no Electron inside (so it can be tested): turn the listener on/off,
// pair a phone, list/remove devices, resolve conflicts. main.js only forwards IPC calls to this class.
const DEFAULT_PORT = 47820; // Phoneix uses 47810

class SyncManager {
  constructor({ getNotesDir, dataDir, protect, unprotect, trash, pcName = os.hostname(), getLang = () => 'en', isLiveEnabled = () => false, onChange = () => {}, interfaces = os.networkInterfaces }) {
    this.state = new SyncState(path.join(dataDir, 'sync.json'), { protect, unprotect });
    this.vault = new Vault(getNotesDir, { trash });
    this.getLang = getLang;
    this.onChange = onChange;
    this.interfaces = interfaces;
    this.live = new LiveHub({ vault: this.vault, enabled: isLiveEnabled, onRemote: (e) => this.onChange({ kind: 'live', ...e }) });
    this.server = new SyncServer({
      vault: this.vault,
      live: this.live,
      state: this.state,
      name: pcName,
      onSynced: (info) => this.onChange({ kind: 'synced', ...info }),
      onPaired: (id) => this.onChange({ kind: 'paired', device: id }),
    });
    this.port = null;
  }

  get running() {
    return this.port !== null;
  }

  // The phone is on Wi-Fi, so the real Wi-Fi adapter goes first. Adapters that only exist inside this PC
  // (WSL, Hyper-V, VirtualBox, VPN) and the Windows hotspot address come last. All of them go into the QR code,
  // the phone tries them in this order.
  hosts() {
    const virtual = /vethernet|wsl|hyper-v|virtualbox|vmware|vmnet|docker|tailscale|zerotier|vpn|loopback|bluetooth/i;
    const wifi = /wi-?fi|wlan|wireless/i;
    const found = [];
    for (const [name, list] of Object.entries(this.interfaces())) {
      for (const i of list || []) {
        if (i.family !== 'IPv4' || i.internal) continue;
        let rank = virtual.test(name) ? 5 : wifi.test(name) ? 0 : 1;
        if (/^192\.168\.(137|56)\./.test(i.address)) rank = Math.max(rank, 4); // Windows hotspot, VirtualBox host-only
        found.push({ address: i.address, rank });
      }
    }
    return found.sort((a, b) => a.rank - b.rank).map((x) => x.address);
  }

  async start() {
    if (this.running) return this.port;
    const wanted = this.state.data.port || DEFAULT_PORT;
    try {
      this.port = await this.server.start(wanted);
    } catch {
      this.port = await this.server.start(0);
    }
    if (this.port !== this.state.data.port) {
      this.state.data.port = this.port;
      this.state.save();
    }
    return this.port;
  }

  stop() {
    this.live.closeAll();
    this.server.stop();
    this.port = null;
  }

  async setEnabled(on) {
    if (on) await this.start();
    else this.stop();
    this.onChange({ kind: 'state' });
  }

  async startPairing() {
    await this.start();
    for (const d of this.state.list()) if (d.pending) this.state.remove(d.id); // an unfinished scan is simply replaced
    const { deviceId, payload } = this.server.startPairing({ hosts: this.hosts(), port: this.port });
    // Black modules on white: the only combination every phone camera reads reliably.
    const qr = await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 2, width: 280, color: { dark: '#000000', light: '#ffffff' } });
    this.onChange({ kind: 'state' });
    return { deviceId, qr, payload };
  }

  cancelPairing() {
    for (const d of this.state.list()) if (d.pending) this.state.remove(d.id);
    this.onChange({ kind: 'state' });
  }

  removeDevice(id) {
    this.state.remove(id);
    this.onChange({ kind: 'state' });
  }

  status() {
    const all = this.state.list();
    return {
      running: this.running,
      port: this.port,
      hosts: this.hosts(),
      devices: all.filter((d) => !d.pending),
      pairing: all.some((d) => d.pending),
      pcName: this.server.name,
      conflicts: this.state.openConflicts(),
    };
  }

  // choice: 'desktop' keep this PC's text | 'phone' take the phone's text | 'merge' both texts in one note | 'both' keep two notes.
  // Nothing is ever deleted for good: removed notes go to the Recycle Bin, and the change reaches the phone on the next sync.
  async resolveConflict(copyId, choice) {
    const conflict = this.state.openConflicts().find((c) => c.copyId === copyId);
    if (!conflict) return;
    const files = this.vault.scan();
    const orig = files.get(conflict.noteId);
    const copy = files.get(copyId);

    if (orig && copy) {
      if (choice === 'phone') {
        this.vault.write(conflict.noteId, restoreFromCopy(copy.raw, conflict.noteId, orig.raw));
        await this.vault.remove(copyId);
      } else if (choice === 'desktop') {
        await this.vault.remove(copyId);
      } else if (choice === 'merge') {
        const tr = this.getLang() === 'tr';
        const phoneBody = bodyOf(restoreFromCopy(copy.raw, conflict.noteId, orig.raw)).replace(/^#[ \t]+.*\r?\n?/, '').trim();
        const label = tr ? `Telefondaki sürüm (${conflict.deviceName})` : `Version from ${conflict.deviceName}`;
        const merged = `${bodyOf(orig.raw).trimEnd()}\n\n---\n\n> ${label}\n\n${phoneBody}\n`;
        this.vault.write(conflict.noteId, withBody(orig.raw, merged));
        await this.vault.remove(copyId);
      } else if (choice !== 'both') {
        throw new Error('unknown choice');
      }
    }
    this.state.closeConflict(copyId);
    this.onChange({ kind: 'state' });
  }
}

module.exports = { SyncManager, DEFAULT_PORT };
