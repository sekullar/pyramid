const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SyncManager } = require('./manager');
const { makeConflictCopy, idOf } = require('./hash');

const note = (id, body) => `---\nid: ${id}\ncreated: 2026-10-24T10:00:00Z\nupdated: 2026-10-31T10:00:00Z\ntags: []\n---\n${body}`;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pyramid-mgr-'));
const fakeInterfaces = () => ({
  lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  eth: [{ family: 'IPv4', address: '10.0.0.5', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
  wifi: [{ family: 'IPv4', address: '192.168.1.45', internal: false }],
});

function make(t, extra = {}) {
  const notes = tmp();
  const data = tmp();
  const events = [];
  const m = new SyncManager({ getNotesDir: () => notes, dataDir: data, pcName: 'Test PC', interfaces: fakeInterfaces, onChange: (e) => events.push(e), ...extra });
  t.after(() => {
    m.stop();
    fs.rmSync(notes, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  });
  return { m, notes, data, events };
}

// A conflict as the server leaves it: original with the PC text, copy with the phone text, open record in the state.
function conflict(m, { pc = '# Plan\nPC text', phone = '# Plan\nPHONE text' } = {}) {
  m.vault.write('orig', note('orig', pc));
  m.vault.write('copy', makeConflictCopy(note('orig', phone), { newId: 'copy', label: 'Galaxy', date: '2026-10-31' }));
  m.state.addConflict({ noteId: 'orig', copyId: 'copy', device: 'd1', deviceName: 'Galaxy', at: new Date().toISOString() });
}

test('addresses: Wi-Fi adapter first, loopback and IPv6 left out', (t) => {
  assert.deepEqual(make(t).m.hosts(), ['192.168.1.45', '10.0.0.5']);
});

test('addresses: Windows hotspot and virtual adapters come after the real Wi-Fi, but stay in the list', (t) => {
  const interfaces = () => ({
    'Local Area Connection* 2': [{ family: 'IPv4', address: '192.168.137.1', internal: false }],
    'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.0.1', internal: false }],
    'Wi-Fi': [{ family: 'IPv4', address: '172.16.26.81', internal: false }],
  });
  assert.deepEqual(make(t, { interfaces }).m.hosts(), ['172.16.26.81', '192.168.137.1', '172.20.0.1']);
});

test('off until enabled; enabling opens a port, disabling closes it', async (t) => {
  const { m } = make(t);
  assert.equal(m.status().running, false);
  await m.setEnabled(true);
  assert.equal(m.status().running, true);
  assert.ok(m.status().port > 0);
  await m.setEnabled(false);
  assert.equal(m.status().running, false);
});

test('port is remembered so an old QR keeps working after a restart', async (t) => {
  const { m, data, notes } = make(t);
  await m.start();
  const port = m.port;
  m.stop();
  const again = new SyncManager({ getNotesDir: () => notes, dataDir: data, interfaces: fakeInterfaces });
  t.after(() => again.stop());
  assert.equal(await again.start(), port);
});

test('pairing returns a QR image, starts the listener, and shows as pairing until the phone answers', async (t) => {
  const { m, events } = make(t);
  const { qr, deviceId } = await m.startPairing();
  assert.match(qr, /^data:image\/png;base64,/);
  assert.equal(m.status().running, true);
  assert.equal(m.status().pairing, true);
  assert.deepEqual(m.status().devices, []);
  assert.ok(deviceId);
  assert.ok(events.some((e) => e.kind === 'state'));
});

test('a second pairing replaces an unfinished one', async (t) => {
  const { m } = make(t);
  const a = await m.startPairing();
  const b = await m.startPairing();
  assert.notEqual(a.deviceId, b.deviceId);
  assert.equal(m.state.list().length, 1);
});

test('cancel pairing removes the pending device, paired devices stay', async (t) => {
  const { m } = make(t);
  const { deviceId } = await m.startPairing();
  m.state.confirm(deviceId);
  await m.startPairing();
  m.cancelPairing();
  assert.deepEqual(m.status().devices.map((d) => d.id), [deviceId]);
  assert.equal(m.status().pairing, false);
});

test('removing a device unpairs it', async (t) => {
  const { m } = make(t);
  const { deviceId } = await m.startPairing();
  m.state.confirm(deviceId);
  m.removeDevice(deviceId);
  assert.deepEqual(m.status().devices, []);
  assert.equal(m.state.device(deviceId), null);
});

// ---------- conflict resolution ----------

test('keep the PC version: the phone copy is removed, the PC text stays', async (t) => {
  const { m } = make(t);
  conflict(m);
  await m.resolveConflict('copy', 'desktop');
  assert.match(m.vault.read('orig'), /PC text/);
  assert.throws(() => m.vault.read('copy'));
  assert.equal(m.status().conflicts.length, 0);
});

test('keep the phone version: its text replaces the original, without the conflict mark in the title', async (t) => {
  const { m } = make(t);
  conflict(m);
  await m.resolveConflict('copy', 'phone');
  const text = m.vault.read('orig');
  assert.match(text, /PHONE text/);
  assert.doesNotMatch(text, /PC text|çakışma/);
  assert.match(text, /^# Plan$/m);
  assert.equal(idOf(text), 'orig');
  assert.throws(() => m.vault.read('copy'));
});

test('keep both: nothing changes except that the question is closed', async (t) => {
  const { m } = make(t);
  conflict(m);
  await m.resolveConflict('copy', 'both');
  assert.match(m.vault.read('orig'), /PC text/);
  assert.match(m.vault.read('copy'), /PHONE text/);
  assert.equal(m.status().conflicts.length, 0);
});

test('merge into one note: both texts are in the original, labelled, copy removed', async (t) => {
  const { m } = make(t, { getLang: () => 'tr' });
  conflict(m);
  await m.resolveConflict('copy', 'merge');
  const text = m.vault.read('orig');
  assert.match(text, /PC text/);
  assert.match(text, /PHONE text/);
  assert.match(text, /Telefondaki sürüm \(Galaxy\)/);
  assert.ok(text.indexOf('PC text') < text.indexOf('PHONE text'));
  assert.doesNotMatch(text, /çakışma/);
  assert.throws(() => m.vault.read('copy'));
});

test('unknown choice is refused and leaves the conflict open', async (t) => {
  const { m } = make(t);
  conflict(m);
  await assert.rejects(m.resolveConflict('copy', 'explode'), /unknown choice/);
  assert.equal(m.status().conflicts.length, 1);
});

test('resolving a conflict whose note was already deleted just closes it', async (t) => {
  const { m } = make(t);
  conflict(m);
  await m.vault.remove('copy');
  await m.resolveConflict('copy', 'phone');
  assert.match(m.vault.read('orig'), /PC text/);
  assert.equal(m.status().conflicts.length, 0);
});

test('resolving the same conflict twice is harmless', async (t) => {
  const { m } = make(t);
  conflict(m);
  await m.resolveConflict('copy', 'desktop');
  await m.resolveConflict('copy', 'phone');
  assert.match(m.vault.read('orig'), /PC text/);
});
