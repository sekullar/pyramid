const crypto = require('crypto');
const { bodyOf, withBody } = require('./hash');

// The desktop's half of letter-by-letter live typing (see ot.mjs for the rules).
//
// For every note that is being edited live, the desktop keeps the one true text and a numbered list of changes.
// Devices (the phone over the sync connection, this app's own editor window over IPC) send
//   {id, ep, rev, ops, seq, cid, wait}
// and get back the changes made by others since `rev`, plus a size and checksum so a device can notice drifting.
//   rev -1            open: the reply carries the whole text and the epoch `ep`
//   ops empty         "anything new?": answered at once, or held for up to `wait` ms until something changes
// A request that repeats (cid, seq) gets the first answer again, so a retry after a dropped connection never types twice.
// The note file is written shortly after each change; the normal sync flushes and closes everything before it looks at files.

const WRITE_DELAY_MS = 250;
const IDLE_MS = 60_000;
const MAX_WAIT_MS = 25_000;
const MAX_HISTORY = 5000;
const MAX_TEXT = 2 * 1024 * 1024;

class LiveError extends Error {}

class LiveHub {
  // vault: for reading/writing the note file. enabled(): the user's switch. onRemote({id, rev}): something changed.
  constructor({ vault, enabled = () => true, onRemote = () => {}, clock = Date.now }) {
    this.vault = vault;
    this.enabled = enabled;
    this.onRemote = onRemote;
    this.clock = clock;
    this.docs = new Map();
    this.ot = null;
    this.sweeper = setInterval(() => this.#sweep(), 10_000);
    this.sweeper.unref?.();
  }

  async #load() {
    this.ot ||= await import('./ot.mjs');
    return this.ot;
  }

  #doc(id) {
    let doc = this.docs.get(id);
    if (doc) return doc;
    let raw;
    try {
      raw = this.vault.read(id);
    } catch {
      throw new LiveError('NO_NOTE');
    }
    const text = bodyOf(raw).replace(/\r\n/g, '\n');
    if (text.length > MAX_TEXT) throw new LiveError('TOO_BIG');
    doc = { id, text, epoch: crypto.randomBytes(6).toString('hex'), first: 0, history: [], last: new Map(), waiters: new Map(), timer: null, touched: this.clock() };
    this.docs.set(id, doc);
    return doc;
  }

  #rev(doc) {
    return doc.first + doc.history.length;
  }

  async handle(msg) {
    if (!this.enabled()) throw new LiveError('LIVE_OFF');
    const ot = await this.#load();
    const id = String(msg.id || '');
    const doc = this.#doc(id);
    doc.touched = this.clock();
    const cid = String(msg.cid || '');
    const open = () => ({ ok: true, ep: doc.epoch, rev: this.#rev(doc), text: doc.text });

    if (!Number.isInteger(msg.rev) || msg.rev < 0) return open();
    // The device's picture is from an older life of this note (closed, or changed by the normal sync): start over.
    if (msg.ep !== doc.epoch || msg.rev > this.#rev(doc) || msg.rev < doc.first) return { ok: false, error: 'REOPEN' };

    const ops = Array.isArray(msg.ops) ? msg.ops : [];
    if (ops.length) {
      const again = doc.last.get(cid);
      if (again && again.seq === msg.seq) return again.reply;
      let mine = ops;
      for (const h of doc.history.slice(msg.rev - doc.first)) mine = ot.xform(h, mine)[1];
      if (!ot.valid(doc.text, mine)) throw new LiveError('BAD_OPS');
      const entries = doc.history.slice(msg.rev - doc.first);
      doc.text = ot.apply(doc.text, mine);
      if (doc.text.length > MAX_TEXT) throw new LiveError('TOO_BIG');
      if (mine.length) doc.history.push(mine);
      if (doc.history.length > MAX_HISTORY) {
        doc.history.splice(0, doc.history.length - MAX_HISTORY);
        doc.first = this.#rev(doc) - doc.history.length;
      }
      const reply = this.#reply(ot, doc, entries);
      doc.last.set(cid, { seq: msg.seq, reply });
      this.#changed(doc, cid);
      return reply;
    }

    let entries = doc.history.slice(msg.rev - doc.first);
    const wait = Math.min(Math.max(Number(msg.wait) || 0, 0), MAX_WAIT_MS);
    if (!entries.length && wait > 0) {
      await new Promise((resolve) => {
        doc.waiters.get(cid)?.(); // a device only ever has one waiting request
        const timer = setTimeout(done, wait);
        function done() {
          clearTimeout(timer);
          if (doc.waiters.get(cid) === done) doc.waiters.delete(cid);
          resolve();
        }
        doc.waiters.set(cid, done);
      });
      entries = doc.history.slice(msg.rev - doc.first);
    }
    return this.#reply(ot, doc, entries);
  }

  #reply(ot, doc, entries) {
    return { ok: true, rev: this.#rev(doc), entries, len: doc.text.length, cs: ot.checksum(doc.text) };
  }

  #changed(doc, fromCid) {
    for (const [cid, wake] of doc.waiters) if (cid !== fromCid) wake();
    this.onRemote({ id: doc.id, rev: this.#rev(doc), from: fromCid });
    clearTimeout(doc.timer);
    doc.timer = setTimeout(() => this.#write(doc), WRITE_DELAY_MS);
  }

  #write(doc) {
    clearTimeout(doc.timer);
    doc.timer = null;
    try {
      const raw = this.vault.read(doc.id);
      if (bodyOf(raw).replace(/\r\n/g, '\n') !== doc.text) this.vault.write(doc.id, withBody(raw, doc.text));
    } catch {
      this.docs.delete(doc.id); // the note is gone; devices will be told to reopen
    }
  }

  // Write everything to disk now (Ctrl+S, closing a note).
  flush(id) {
    for (const doc of this.docs.values()) if ((!id || doc.id === id) && doc.timer) this.#write(doc);
  }

  // Before the normal sync looks at the files: write every open note and forget them. Devices reopen on their next call.
  closeAll() {
    const ids = [...this.docs.keys()];
    this.flush();
    for (const doc of this.docs.values()) for (const wake of doc.waiters.values()) wake();
    this.docs.clear();
    for (const id of ids) this.onRemote({ id, rev: -1, from: '' });
  }

  #sweep() {
    const now = this.clock();
    for (const doc of this.docs.values()) {
      if (now - doc.touched > IDLE_MS) {
        this.#write(doc);
        this.docs.delete(doc.id);
      }
    }
  }

  stop() {
    clearInterval(this.sweeper);
    this.closeAll();
  }
}

module.exports = { LiveHub, LiveError };
