const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SyncServer } = require('./server');
const { SyncState } = require('./state');
const { Vault } = require('./vault');
const { LiveHub } = require('./live');
const { seal, open } = require('./crypto');
const { bodyOf } = require('./hash');

const note = (id, body) => `---\nid: ${id}\ncreated: 2026-10-24T10:00:00Z\nupdated: 2026-10-31T10:00:00Z\ntags: []\n---\n${body}`;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pyramid-live-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup(t, { on = true } = {}) {
  const dir = tmp();
  const stateDir = tmp();
  const vault = new Vault(() => dir);
  const events = [];
  const live = new LiveHub({ vault, enabled: () => on, onRemote: (e) => events.push(e) });
  const server = new SyncServer({ vault, state: new SyncState(path.join(stateDir, 'sync.json')), live, name: 'Test PC' });
  const port = await server.start(0, '127.0.0.1');
  const pairing = server.startPairing({ hosts: ['127.0.0.1'], port });
  const data = JSON.parse(Buffer.from(new URL(pairing.payload).searchParams.get('d'), 'base64url').toString());
  const key = Buffer.from(data.k, 'base64');
  const call = async (type, fields = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}/pyramid/v1?d=${data.d}`, { method: 'POST', body: seal(key, { t: Date.now(), type, ...fields }) });
    assert.equal(res.status, 200);
    return open(key, await res.text()).msg;
  };
  t.after(() => {
    live.stop();
    server.stop();
    for (const d of [dir, stateDir]) fs.rmSync(d, { recursive: true, force: true });
  });
  return { vault, live, call, events, dir };
}

// A device that talks to the desktop: the phone's way (sealed HTTP) or the editor window's way (straight to the hub).
async function device(ot, cid, send, id, local) {
  const c = new ot.LiveClient(cid);
  const first = await send({ type: 'live', id, rev: -1 });
  c.open(first.text, first.rev, first.ep);
  const dev = { c, text: local ?? first.text, id };
  dev.sync = async (wait = 0) => {
    const req = c.prepare(dev.text);
    const reply = await send({ type: 'live', id, ...req, wait });
    if (!reply.ok) throw new Error(reply.error);
    dev.text = c.receive(reply, dev.text);
    return reply;
  };
  return dev;
}

test('the phone types, the PC window sees it, and the file follows', async (t) => {
  const ot = await import('./ot.mjs');
  const { vault, live, call } = await setup(t);
  vault.write('n1', note('n1', '# Plan\n\nilk\n'));
  const phone = await device(ot, 'phone', (m) => call(m.type, m), 'n1');
  const pc = await device(ot, 'pc', (m) => live.handle(m), 'n1');
  assert.equal(phone.text, '# Plan\n\nilk\n');

  phone.text = '# Plan\n\nilk satır\n';
  await phone.sync();
  await pc.sync();
  assert.equal(pc.text, '# Plan\n\nilk satır\n');

  await sleep(400);
  assert.equal(bodyOf(vault.read('n1')), '# Plan\n\nilk satır\n');
  assert.match(vault.read('n1'), /^---\nid: n1\n/); // front matter kept
});

test('both type at once, nothing is lost and both end the same', async (t) => {
  const ot = await import('./ot.mjs');
  const { vault, live, call } = await setup(t);
  vault.write('n1', note('n1', 'abc\n'));
  const phone = await device(ot, 'phone', (m) => call(m.type, m), 'n1');
  const pc = await device(ot, 'pc', (m) => live.handle(m), 'n1');
  phone.text = 'abcP\n';
  pc.text = 'Xabc\n';
  await phone.sync();
  await pc.sync();
  await phone.sync();
  assert.equal(phone.text, 'XabcP\n');
  assert.equal(pc.text, 'XabcP\n');
});

test('a waiting poll is answered as soon as the other side types', async (t) => {
  const ot = await import('./ot.mjs');
  const { vault, live, call } = await setup(t);
  vault.write('n1', note('n1', 'x'));
  const phone = await device(ot, 'phone', (m) => call(m.type, m), 'n1');
  const pc = await device(ot, 'pc', (m) => live.handle(m), 'n1');
  const started = Date.now();
  const waiting = phone.sync(8000);
  await sleep(100);
  pc.text = 'xy';
  await pc.sync();
  await waiting;
  assert.equal(phone.text, 'xy');
  assert.ok(Date.now() - started < 3000, 'did not wait for the timeout');
});

test('sending the same request twice types once', async (t) => {
  const ot = await import('./ot.mjs');
  const { vault, live } = await setup(t);
  vault.write('n1', note('n1', 'a'));
  const c = new ot.LiveClient('p');
  const first = await live.handle({ id: 'n1', rev: -1 });
  c.open(first.text, first.rev, first.ep);
  const req = c.prepare('ab');
  const r1 = await live.handle({ id: 'n1', ...req });
  const r2 = await live.handle({ id: 'n1', ...req }); // the reply got lost, the phone asks again
  assert.deepEqual(r2, r1);
  assert.equal(c.receive(r1, 'ab'), 'ab');
  assert.equal((await live.handle({ id: 'n1', rev: -1 })).text, 'ab');
});

test('the normal sync closes live notes and devices are told to reopen', async (t) => {
  const ot = await import('./ot.mjs');
  const { vault, live, call } = await setup(t);
  vault.write('n1', note('n1', 'hello'));
  const phone = await device(ot, 'phone', (m) => call(m.type, m), 'n1');
  phone.text = 'hello!';
  await phone.sync();
  await call('sync', { snapshot: {} }); // the phone list syncs: the file must be current right away
  assert.equal(bodyOf(vault.read('n1')), 'hello!');
  const reply = await call('live', { id: 'n1', ...phone.c.prepare(phone.text) });
  assert.equal(reply.ok, false);
  assert.equal(reply.error, 'REOPEN');
});

test('with the setting off the phone is told so', async (t) => {
  const { vault, call } = await setup(t, { on: false });
  vault.write('n1', note('n1', 'x'));
  const reply = await call('live', { id: 'n1', rev: -1 });
  assert.equal(reply.ok, false);
  assert.equal(reply.error, 'LIVE_OFF');
  assert.equal((await call('hello', { name: 'p' })).live, false);
});

test('nonsense changes are refused and the note stays as it was', async (t) => {
  const ot = await import('./ot.mjs');
  const { vault, live } = await setup(t);
  vault.write('n1', note('n1', 'abc'));
  const first = await live.handle({ id: 'n1', rev: -1 });
  await assert.rejects(live.handle({ id: 'n1', ep: first.ep, rev: first.rev, seq: 1, cid: 'x', ops: [['d', 2, 50]] }), /BAD_OPS/);
  await assert.rejects(live.handle({ id: 'n1', ep: first.ep, rev: first.rev, seq: 2, cid: 'x', ops: [['i', -1, 'z']] }), /BAD_OPS/);
  assert.equal((await live.handle({ id: 'n1', rev: -1 })).text, 'abc');
  assert.equal(typeof ot.valid, 'function');
});
