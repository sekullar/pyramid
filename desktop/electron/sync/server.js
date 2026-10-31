const http = require('http');
const crypto = require('crypto');
const { newKey, seal, open, MAX_AGE_MS } = require('./crypto');
const { plan } = require('./engine');
const { hashNote, makeConflictCopy } = require('./hash');

// Desktop side of the Wi-Fi sync. The phone always starts; the desktop only listens.
//
//   POST /pyramid/v1?d=<deviceId>   body = sealed message {t, type, ...}   reply = sealed {ok, ...}
//
//   hello   {name}                       -> {name}                         first contact after the QR scan
//   sync    {snapshot}                   -> {session, actions}             desktop runs the engine (phone = side b)
//   get     {id}                         -> {text}                         phone pulls a note it must write
//   put     {session, id, text}          -> {} | {copy}                    phone pushes a note it changed;
//                                                                          for a conflict the reply carries the copy
//   commit  {session}                    -> {nextBase}                     phone has applied everything
//   live    {id, ep, rev, ops, seq, cid, wait} -> see live.js                 letter-by-letter typing (optional setting)
//
// The phone sends `commit` only after it has written its side, so a crash in between can only make the next sync
// repeat work, never lose a note: the agreed state (`base`) is saved on commit.
// Anything that is not a valid, fresh, never-seen message gets a bare 404, like Phoneix.

const MAX_BODY = 4 * 1024 * 1024;
const SESSION_MS = 5 * 60_000;

class SyncServer {
  constructor({ vault, state, live = null, name = 'PC', clock = Date.now, onSynced = () => {}, onPaired = () => {} }) {
    this.vault = vault;
    this.live = live; // LiveHub: letter-by-letter typing, optional
    this.state = state;
    this.name = name;
    this.clock = clock;
    this.onSynced = onSynced;
    this.onPaired = onPaired;
    this.seen = new Map(); // nonce -> time, to refuse a replayed message
    this.sessions = new Map();
    this.server = null;
  }

  start(port = 0, host = '0.0.0.0') {
    this.server = http.createServer((req, res) => this.#http(req, res));
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => resolve(this.server.address().port));
    });
  }

  stop() {
    this.server?.close();
    this.server = null;
  }

  // Called when the user opens the "pair phone" screen. Returns what goes into the QR code.
  startPairing({ hosts, port }) {
    const key = newKey();
    const id = crypto.randomBytes(8).toString('hex');
    this.state.addPending(id, 'phone', key);
    const data = { v: 1, n: this.name, h: hosts, p: port, k: key.toString('base64'), d: id };
    return { deviceId: id, payload: `pyramid://pair?d=${Buffer.from(JSON.stringify(data)).toString('base64url')}` };
  }

  #http(req, res) {
    const url = new URL(req.url, 'http://x');
    const nope = () => {
      res.writeHead(404);
      res.end();
    };
    if (req.method !== 'POST' || url.pathname !== '/pyramid/v1') return nope();
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(c);
    });
    req.on('end', async () => {
      try {
        const reply = await this.handle(url.searchParams.get('d') || '', Buffer.concat(chunks).toString('utf8'));
        if (reply == null) return nope();
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(reply);
      } catch {
        nope();
      }
    });
  }

  // Exposed for tests. Returns the sealed reply, or null for "answer 404".
  async handle(deviceId, body) {
    const dev = this.state.device(deviceId);
    if (!dev) return null;
    let opened;
    try {
      opened = open(dev.key, body, this.clock());
    } catch {
      return null;
    }
    const now = this.clock();
    for (const [n, t] of this.seen) if (now - t > MAX_AGE_MS * 2) this.seen.delete(n);
    if (this.seen.has(opened.nonce)) return null;
    this.seen.set(opened.nonce, now);
    const wasPending = dev.pending;
    this.state.confirm(deviceId);
    if (wasPending) this.onPaired(deviceId);

    let out;
    try {
      out = await this.#process(dev, opened.msg);
    } catch (err) {
      out = { ok: false, error: err.message };
    }
    return seal(dev.key, { t: now, ...out });
  }

  async #process(dev, msg) {
    switch (msg.type) {
      case 'hello':
        this.state.setName(dev.id, msg.name);
        return { ok: true, name: this.name, live: !!this.live?.enabled() };

      case 'sync': {
        this.live?.closeAll(); // open live notes go to disk first, so the files below are the truth
        const base = this.state.device(dev.id).base;
        const snapshotA = this.vault.snapshot(base);
        const date = new Date(this.clock()).toISOString().slice(0, 10);
        const { actions, nextBase } = plan(snapshotA, msg.snapshot || {}, base);
        const session = crypto.randomBytes(8).toString('hex');
        this.#dropOldSessions();
        this.sessions.set(session, { device: dev.id, actions, nextBase, snapshotB: msg.snapshot || {}, received: new Set(), date, started: this.clock() });
        return { ok: true, session, actions };
      }

      case 'live':
        if (!this.live) throw new Error('LIVE_OFF');
        return this.live.handle(msg);

      case 'get':
        return { ok: true, text: this.vault.read(msg.id) };

      case 'put': {
        const s = this.#session(msg.session, dev.id);
        const a = s.actions.find((x) => x.id === msg.id && (x.from === 'b' || x.type === 'conflict'));
        if (!a) throw new Error('not expected in this sync');
        const claimed = s.snapshotB[msg.id];
        if (!claimed || hashNote(msg.text) !== claimed.hash) throw new Error('note changed during sync, try again');
        if (a.type === 'conflict') {
          const copy = makeConflictCopy(msg.text, { newId: a.copyId, label: dev.name, date: s.date });
          this.vault.write(a.copyId, copy);
          s.nextBase[a.copyId] = { hash: hashNote(copy) };
          this.state.addConflict({ noteId: a.id, copyId: a.copyId, device: dev.id, deviceName: dev.name, at: new Date(this.clock()).toISOString() });
          s.received.add(msg.id);
          return { ok: true, copy };
        }
        this.vault.write(msg.id, msg.text);
        s.received.add(msg.id);
        return { ok: true };
      }

      case 'commit': {
        const s = this.#session(msg.session, dev.id);
        const missing = s.actions.filter((x) => (x.from === 'b' || x.type === 'conflict') && !s.received.has(x.id));
        if (missing.length) throw new Error(`missing notes: ${missing.map((x) => x.id).join(',')}`);
        for (const a of s.actions) if (a.type === 'delete' && a.on === 'a') await this.vault.remove(a.id);
        this.state.setBase(dev.id, s.nextBase);
        this.state.setLastSync(dev.id, new Date(this.clock()).toISOString());
        this.sessions.delete(msg.session);
        this.onSynced({ device: dev.id, actions: s.actions });
        return { ok: true, nextBase: s.nextBase };
      }

      default:
        throw new Error('unknown type');
    }
  }

  #session(id, deviceId) {
    const s = this.sessions.get(id);
    if (!s || s.device !== deviceId) throw new Error('unknown or expired session');
    return s;
  }

  #dropOldSessions() {
    const now = this.clock();
    for (const [id, s] of this.sessions) if (now - s.started > SESSION_MS) this.sessions.delete(id);
  }
}

module.exports = { SyncServer };
