const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { readInfo, publicInfo, sendPairLink } = require('./phoneix');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pyramid-phoneix-'));

// A stand-in for Phoneix's local API.
async function fakePhoneix(t, { status = 200, body = { ok: true }, token = 'secret' } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: data ? JSON.parse(data) : null });
      if (req.headers.authorization !== `Bearer ${token}`) { res.statusCode = 401; return res.end('{}'); }
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return { port: server.address().port, seen };
}
const info = (port, extra = {}) => ({ found: true, running: true, paired: true, phone: 'A36', port, token: 'secret', ...extra });

test('readInfo reads the file Phoneix writes and notices a dead process', () => {
  const dir = tmp();
  const file = path.join(dir, 'phoneix.json');
  fs.writeFileSync(file, JSON.stringify({ app: 'phoneix', port: 5, token: 't', pid: process.pid, paired: true, phone: 'My phone' }));
  assert.deepEqual(readInfo(file), { found: true, running: true, paired: true, phone: 'My phone', port: 5, token: 't' });
  fs.writeFileSync(file, JSON.stringify({ port: 5, token: 't', pid: 2 ** 22 + 12345, paired: false }));
  const dead = readInfo(file);
  assert.equal(dead.running, false);
  assert.equal(dead.paired, false);
  assert.equal(readInfo(path.join(dir, 'nope.json')).found, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('what the window sees has no port and no token', () => {
  assert.deepEqual(Object.keys(publicInfo(info(1))).sort(), ['found', 'paired', 'phone', 'running']);
});

test('the link goes to Phoneix with its token', async (t) => {
  const px = await fakePhoneix(t);
  await sendPairLink(info(px.port), 'pyramid://pair?d=abc_DEF-123');
  assert.equal(px.seen.length, 1);
  assert.equal(px.seen[0].method, 'POST');
  assert.equal(px.seen[0].url, '/link');
  assert.equal(px.seen[0].auth, 'Bearer secret');
  assert.deepEqual(px.seen[0].body, { url: 'pyramid://pair?d=abc_DEF-123' });
});

test('Phoneix not running, not paired, too old or refusing give clear errors', async (t) => {
  await assert.rejects(sendPairLink(info(1, { found: false }), 'x'), /PHONEIX_DOWN/);
  await assert.rejects(sendPairLink(info(1, { running: false }), 'x'), /PHONEIX_DOWN/);
  await assert.rejects(sendPairLink(info(1, { paired: false }), 'x'), /PHONEIX_UNPAIRED/);
  await assert.rejects(sendPairLink(info(1), 'x'), /PHONEIX_DOWN/); // nothing listens on port 1
  const old = await fakePhoneix(t, { status: 404, body: { ok: false } });
  await assert.rejects(sendPairLink(info(old.port), 'x'), /PHONEIX_OLD/);
  const unpaired = await fakePhoneix(t, { status: 409, body: { ok: false, error: 'Telefon eşleşmemiş' } });
  await assert.rejects(sendPairLink(info(unpaired.port), 'x'), /PHONEIX_UNPAIRED/);
  const refused = await fakePhoneix(t, { status: 400, body: { ok: false, error: 'url' } });
  await assert.rejects(sendPairLink(info(refused.port), 'x'), /PHONEIX_REFUSED/);
});
