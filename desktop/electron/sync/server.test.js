const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SyncServer } = require('./server');
const { SyncState } = require('./state');
const { Vault } = require('./vault');
const { seal, open } = require('./crypto');
const { hashNote } = require('./hash');

const note = (id, body) => `---\nid: ${id}\ncreated: 2026-10-24T10:00:00Z\nupdated: 2026-10-31T10:00:00Z\ntags: []\n---\n${body}`;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pyramid-sync-'));

// A stand-in for the phone: same steps the Android app will do. Keeps its own base, like the real one will.
class FakePhone {
  constructor(dir, pairing) {
    this.vault = new Vault(() => dir);
    this.base = {};
    const data = JSON.parse(Buffer.from(new URL(pairing.payload).searchParams.get('d'), 'base64url').toString());
    this.key = Buffer.from(data.k, 'base64');
    this.deviceId = data.d;
    this.url = `http://127.0.0.1:${data.p}/pyramid/v1?d=${this.deviceId}`;
  }

  async call(type, fields = {}, { key = this.key, t = Date.now() } = {}) {
    const res = await fetch(this.url, { method: 'POST', body: seal(key, { t, type, ...fields }) });
    if (res.status !== 200) return { status: res.status };
    const reply = open(key, await res.text());
    if (!reply.msg.ok) throw new Error(reply.msg.error);
    return reply.msg;
  }

  async sync() {
    const { session, actions } = await this.call('sync', { snapshot: this.vault.snapshot(this.base) });
    for (const a of actions) {
      if (a.type === 'delete') {
        if (a.on === 'b') await this.vault.remove(a.id);
      } else if (a.type === 'conflict') {
        const { copy } = await this.call('put', { session, id: a.id, text: this.vault.read(a.id) });
        this.vault.write(a.id, (await this.call('get', { id: a.id })).text);
        this.vault.write(a.copyId, copy);
      } else if (a.from === 'b') {
        await this.call('put', { session, id: a.id, text: this.vault.read(a.id) });
      } else {
        this.vault.write(a.id, (await this.call('get', { id: a.id })).text);
      }
    }
    const done = await this.call('commit', { session });
    this.base = done.nextBase;
    return actions;
  }
}

async function setup(t) {
  const pcDir = tmp();
  const phoneDir = tmp();
  const stateDir = tmp();
  const server = new SyncServer({ vault: new Vault(() => pcDir), state: new SyncState(path.join(stateDir, 'sync.json')), name: 'Test PC' });
  const port = await server.start(0, '127.0.0.1');
  const pairing = server.startPairing({ hosts: ['127.0.0.1'], port });
  const phone = new FakePhone(phoneDir, pairing);
  t.after(() => {
    server.stop();
    for (const d of [pcDir, phoneDir, stateDir]) fs.rmSync(d, { recursive: true, force: true });
  });
  return { server, phone, pcDir, phoneDir, stateDir, pc: new Vault(() => pcDir), pairing };
}

const texts = (v) => [...v.scan()].map(([id, f]) => [id, f.raw]).sort();

test('pairing payload has the address, port, key and device id', async (t) => {
  const { pairing, server } = await setup(t);
  assert.match(pairing.payload, /^pyramid:\/\/pair\?d=/);
  const d = JSON.parse(Buffer.from(new URL(pairing.payload).searchParams.get('d'), 'base64url').toString());
  assert.equal(d.v, 1);
  assert.equal(d.n, 'Test PC');
  assert.deepEqual(d.h, ['127.0.0.1']);
  assert.equal(Buffer.from(d.k, 'base64').length, 32);
  assert.equal(server.state.device(d.d).pending, true);
});

test('hello confirms the pairing', async (t) => {
  const { phone, server } = await setup(t);
  const r = await phone.call('hello', { name: 'Galaxy' });
  assert.equal(r.name, 'Test PC');
  assert.equal(server.state.device(phone.deviceId).pending, false);
});

test('first sync copies notes both ways over real HTTP', async (t) => {
  const { phone, pc } = await setup(t);
  pc.write('a', note('a', '# From PC\nhello'));
  phone.vault.write('b', note('b', '# From phone\nhi'));
  await phone.sync();
  assert.deepEqual(texts(pc), texts(phone.vault));
  assert.equal(pc.scan().size, 2);
});

test('edits on each side, then a second sync that has nothing to do', async (t) => {
  const { phone, pc } = await setup(t);
  pc.write('a', note('a', '# A\nv1'));
  pc.write('b', note('b', '# B\nv1'));
  await phone.sync();
  pc.write('a', note('a', '# A\nedited on PC'));
  phone.vault.write('b', note('b', '# B\nedited on phone'));
  await phone.sync();
  assert.match(pc.read('b'), /edited on phone/);
  assert.match(phone.vault.read('a'), /edited on PC/);
  assert.deepEqual(texts(pc), texts(phone.vault));
  assert.deepEqual(await phone.sync(), []);
});

test('conflict: PC text stays, phone text becomes a marked copy on both, nothing lost', async (t) => {
  const { phone, pc } = await setup(t);
  pc.write('n', note('n', '# Plan\nstart'));
  await phone.sync();
  pc.write('n', note('n', '# Plan\nPC wrote this'));
  phone.vault.write('n', note('n', '# Plan\nPHONE wrote this'));
  const actions = await phone.sync();
  assert.equal(actions[0].type, 'conflict');
  assert.equal(pc.scan().size, 2);
  assert.deepEqual(texts(pc), texts(phone.vault));
  assert.match(pc.read('n'), /PC wrote this/);
  const copy = [...pc.scan().values()].find((f) => /PHONE wrote this/.test(f.raw));
  assert.ok(copy);
  assert.match(copy.raw, /\(çakışma - phone - \d{4}-\d{2}-\d{2}\)/);
  assert.deepEqual(await phone.sync(), [], 'no new conflict on the next sync');
});

test('delete on PC reaches the phone (and goes to the trash folder, not away for good)', async (t) => {
  const { phone, pc, pcDir } = await setup(t);
  pc.write('n', note('n', '# N\nx'));
  await phone.sync();
  await pc.remove('n');
  await phone.sync();
  assert.equal(phone.vault.scan().size, 0);
  assert.equal(fs.readdirSync(path.join(pcDir, '.sync-trash')).length, 1);
});

test('delete on phone reaches the PC', async (t) => {
  const { phone, pc } = await setup(t);
  pc.write('n', note('n', '# N\nx'));
  await phone.sync();
  await phone.vault.remove('n');
  await phone.sync();
  assert.equal(pc.scan().size, 0);
});

test('deleted on PC while the phone kept writing: the note comes back', async (t) => {
  const { phone, pc } = await setup(t);
  pc.write('n', note('n', '# N\nv1'));
  await phone.sync();
  await pc.remove('n');
  phone.vault.write('n', note('n', '# N\nphone kept writing'));
  await phone.sync();
  assert.match(pc.read('n'), /phone kept writing/);
});

test('base survives a restart of the desktop app', async (t) => {
  const { phone, pc, server, stateDir } = await setup(t);
  pc.write('n', note('n', '# N\nv1'));
  await phone.sync();
  server.state = new SyncState(path.join(stateDir, 'sync.json'));
  pc.write('n', note('n', '# N\nv2'));
  const actions = await phone.sync();
  assert.deepEqual(actions.map((a) => a.type), ['update']);
});

test('phone that dies before commit: next sync repairs itself without losing or conflicting', async (t) => {
  const { phone, pc } = await setup(t);
  pc.write('n', note('n', '# N\nv1'));
  await phone.sync();
  pc.write('n', note('n', '# N\nv2'));
  // Phone does the work but never sends commit.
  const { actions } = await phone.call('sync', { snapshot: phone.vault.snapshot(phone.base) });
  phone.vault.write('n', (await phone.call('get', { id: 'n' })).text);
  assert.equal(actions[0].type, 'update');
  const next = await phone.sync();
  assert.deepEqual(next, [], 'already equal, only the agreed state is saved');
  assert.match(phone.vault.read('n'), /v2/);
});

test('a note edited on the phone while the sync is running is refused, not half-written', async (t) => {
  const { phone, pc } = await setup(t);
  pc.write('n', note('n', '# N\nv1'));
  await phone.sync();
  phone.vault.write('n', note('n', '# N\nphone v2'));
  const { session } = await phone.call('sync', { snapshot: phone.vault.snapshot(phone.base) });
  await assert.rejects(phone.call('put', { session, id: 'n', text: note('n', '# N\nsomething else') }), /changed during sync/);
  assert.match(pc.read('n'), /v1/);
});

test('commit before all notes were pushed is refused and the agreed state is not saved', async (t) => {
  const { phone, pc, server } = await setup(t);
  phone.vault.write('n', note('n', '# N\nx'));
  const { session } = await phone.call('sync', { snapshot: phone.vault.snapshot(phone.base) });
  await assert.rejects(phone.call('commit', { session }), /missing notes/);
  assert.deepEqual(server.state.device(phone.deviceId).base, {});
  assert.equal(pc.scan().size, 0);
});

// ---------- security ----------

test('wrong key, unknown device, stale timestamp, replay and other paths all get a bare 404', async (t) => {
  const { phone, server } = await setup(t);
  assert.equal((await phone.call('hello', {}, { key: Buffer.alloc(32, 1) })).status, 404);
  assert.equal((await phone.call('hello', {}, { t: Date.now() - 120_000 })).status, 404);

  const other = Object.create(phone);
  other.url = phone.url.replace(/d=[0-9a-f]+/, 'd=ffffffffffffffff');
  assert.equal((await other.call('hello')).status, 404);

  const body = seal(phone.key, { t: Date.now(), type: 'hello' });
  const first = await fetch(phone.url, { method: 'POST', body });
  const replay = await fetch(phone.url, { method: 'POST', body });
  assert.equal(first.status, 200);
  assert.equal(replay.status, 404);

  assert.equal((await fetch(phone.url.replace('/pyramid/v1', '/other'), { method: 'POST', body })).status, 404);
  assert.equal((await fetch(phone.url)).status, 404);
  assert.equal(server.sessions.size, 0);
});

test('unknown message type and a session from another device are refused', async (t) => {
  const { phone } = await setup(t);
  await assert.rejects(phone.call('rm-rf'), /unknown type/);
  await assert.rejects(phone.call('commit', { session: 'nope' }), /unknown or expired session/);
});

test('note with a mismatching id cannot be written', async (t) => {
  const { pc } = await setup(t);
  assert.throws(() => pc.write('x', note('y', '# nope')), /does not match/);
});

test('hash used by the server is the same one the engine reasons about', () => {
  assert.equal(hashNote(note('a', 'x')), hashNote(note('a', 'x')));
});
