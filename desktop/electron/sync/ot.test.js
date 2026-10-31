const test = require('node:test');
const assert = require('node:assert');

// Small seeded random generator so a failing case can be repeated.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const ALPHABET = ['a', 'b', 'c', ' ', '\n', 'ç', 'ğ', '😀'];
const randText = (r, n) => Array.from({ length: n }, () => ALPHABET[Math.floor(r() * ALPHABET.length)]).join('');
// A random edit of `text`: the single change diffOps would produce.
function randomEdit(r, text) {
  const chars = Array.from(text);
  const from = Math.floor(r() * (chars.length + 1));
  const cut = Math.floor(r() * Math.min(4, chars.length - from + 1));
  const add = r() < 0.7 ? randText(r, Math.floor(r() * 4)) : '';
  return chars.slice(0, from).join('') + add + chars.slice(from + cut).join('');
}

test('two changes made at the same time end in the same text (random)', async () => {
  const { diffOps, apply, xform } = await import('./ot.mjs');
  const r = rng(7);
  for (let i = 0; i < 4000; i++) {
    const x = randText(r, Math.floor(r() * 12));
    const a = diffOps(x, randomEdit(r, x));
    const b = diffOps(x, randomEdit(r, x));
    const [a2, b2] = xform(a, b);
    assert.strictEqual(apply(apply(x, b), a2), apply(apply(x, a), b2), JSON.stringify({ x, a, b }));
  }
});

test('diffOps then apply gives the new text, and never cuts an emoji', async () => {
  const { diffOps, apply } = await import('./ot.mjs');
  const r = rng(11);
  for (let i = 0; i < 2000; i++) {
    const x = randText(r, Math.floor(r() * 14));
    const y = randomEdit(r, x);
    const ops = diffOps(x, y);
    assert.strictEqual(apply(x, ops), y);
    for (const [type, , v] of ops) if (type === 'i') assert.ok(!/[\ud800-\udbff]$/.test(v) && !/^[\udc00-\udfff]/.test(v), 'split surrogate');
  }
});

test('insert at the same spot: the server side comes first', async () => {
  const { xform, apply } = await import('./ot.mjs');
  const [serverAfter, clientAfter] = xform([['i', 1, 'S']], [['i', 1, 'C']]);
  assert.strictEqual(apply(apply('ab', [['i', 1, 'C']]), serverAfter), 'aSCb');
  assert.strictEqual(apply(apply('ab', [['i', 1, 'S']]), clientAfter), 'aSCb');
});

test('a delete that contains the other side\'s insert keeps that insert', async () => {
  const { xform, apply } = await import('./ot.mjs');
  const [a2, b2] = xform([['d', 1, 4]], [['i', 3, 'XY']]); // 12345 -> delete "2345" vs insert "XY" after "12"
  assert.strictEqual(apply(apply('12345', [['i', 3, 'XY']]), a2), '1XY');
  assert.strictEqual(apply(apply('12345', [['d', 1, 4]]), b2), '1XY');
});

test('valid() refuses changes that do not fit the text', async () => {
  const { valid } = await import('./ot.mjs');
  assert.ok(valid('abc', [['i', 3, 'x'], ['d', 0, 4]]));
  assert.ok(!valid('abc', [['d', 2, 2]]));
  assert.ok(!valid('abc', [['i', 4, 'x']]));
  assert.ok(!valid('abc', [['x', 0, 1]]));
  assert.ok(!valid('abc', [['i', 0, '']]));
  assert.ok(!valid('abc', 'nope'));
});

// A pretend desktop: holds the true text, numbers changes, answers like server.js will.
class FakeServer {
  constructor(ot, text) {
    this.ot = ot;
    this.text = text;
    this.history = [];
  }
  call({ rev, ops }) {
    const { xform, apply, checksum } = this.ot;
    const entries = this.history.slice(rev);
    let o = ops;
    for (const h of entries) o = xform(h, o)[1];
    if (o.length) {
      this.text = apply(this.text, o);
      this.history.push(o);
    }
    return { rev: this.history.length, entries, len: this.text.length, cs: checksum(this.text) };
  }
}

test('three devices typing at random converge on one text', async () => {
  const ot = await import('./ot.mjs');
  const r = rng(99);
  for (let round = 0; round < 300; round++) {
    const start = randText(r, 6);
    const server = new FakeServer(ot, start);
    const devices = ['p1', 'p2', 'p3'].map((cid) => {
      const c = new ot.LiveClient(cid);
      c.open(start, 0, 'e');
      return { c, text: start, waiting: null };
    });
    for (let step = 0; step < 40; step++) {
      const d = devices[Math.floor(r() * devices.length)];
      if (d.waiting) {
        // the reply arrives; the user may have typed in the meantime
        d.text = d.c.receive(server.call(d.waiting), d.text);
        d.waiting = null;
      } else if (r() < 0.6) {
        d.text = randomEdit(r, d.text);
      } else {
        const req = d.c.prepare(d.text);
        // the request reaches the server now, the reply is read later (so edits can pile up in between)
        const reply = server.call(req);
        d.waiting = null;
        d.pendingReply = reply;
        d.text = d.c.receive(reply, d.text);
      }
    }
    // everyone syncs until quiet
    for (let k = 0; k < 3; k++) {
      for (const d of devices) d.text = d.c.receive(server.call(d.c.prepare(d.text)), d.text);
    }
    for (const d of devices) assert.strictEqual(d.text, server.text, `round ${round}`);
  }
});

test('edits typed while a request is in flight are kept', async () => {
  const ot = await import('./ot.mjs');
  const server = new FakeServer(ot, 'hello');
  const a = new ot.LiveClient('a');
  a.open('hello', 0, 'e');
  const b = new ot.LiveClient('b');
  b.open('hello', 0, 'e');
  let aText = 'hello world';
  const req = a.prepare(aText);
  aText = 'hello world!'; // typed while the request travels
  server.call(b.prepare('Oh hello')); // b got in first
  aText = a.receive(server.call(req), aText);
  assert.strictEqual(aText, 'Oh hello world!');
  aText = a.receive(server.call(a.prepare(aText)), aText);
  assert.strictEqual(server.text, 'Oh hello world!');
});
