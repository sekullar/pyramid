const test = require('node:test');
const assert = require('node:assert/strict');
const { plan } = require('./engine');
const { hashNote, idOf, makeConflictCopy } = require('./hash');

const h = (hash) => ({ hash });
const del = { deleted: true };
let n = 0;
const opts = () => ({ newId: () => `copy-${++n}` });

// ---------- hash ----------

const note = (id, body, { updated = '2026-10-31T10:00:00Z', tags = '' } = {}) =>
  `---\nid: ${id}\ncreated: 2026-10-24T10:00:00Z\nupdated: ${updated}\ntags: [${tags}]\n---\n${body}`;

test('hash ignores updated/created, so re-saving is not an edit', () => {
  assert.equal(hashNote(note('x', '# A\nhi', { updated: '2026-01-01T00:00:00Z' })), hashNote(note('x', '# A\nhi', { updated: '2030-01-01T00:00:00Z' })));
});

test('hash changes when text or tags change', () => {
  const base = hashNote(note('x', '# A\nhi'));
  assert.notEqual(base, hashNote(note('x', '# A\nhi!')));
  assert.notEqual(base, hashNote(note('x', '# A\nhi', { tags: 'work' })));
});

test('hash treats Windows and Android line endings the same', () => {
  assert.equal(hashNote(note('x', 'a\r\nb\r\n')), hashNote(note('x', 'a\nb\n')));
});

test('hash works on a file without front matter', () => {
  assert.equal(typeof hashNote('just text'), 'string');
});

test('idOf reads the id', () => {
  assert.equal(idOf(note('abc', 'x')), 'abc');
  assert.equal(idOf('no front matter'), null);
});

test('conflict copy: new id, title suffix, text kept', () => {
  const copy = makeConflictCopy(note('old', '# Plan\n\nphone text'), { newId: 'new', label: 'telefon', date: '2026-10-31' });
  assert.equal(idOf(copy), 'new');
  assert.match(copy, /^# Plan \(çakışma - telefon - 2026-10-31\)$/m);
  assert.match(copy, /phone text/);
});

test('conflict copy: note with no heading still gets a marked title', () => {
  const copy = makeConflictCopy(note('old', 'no heading here'), { newId: 'new', label: 'telefon', date: '2026-10-31' });
  assert.match(copy, /^# \(çakışma - telefon - 2026-10-31\)$/m);
  assert.match(copy, /no heading here/);
});

test('conflict copy: empty "# " heading (a fresh Untitled note) does not get a double space', () => {
  const copy = makeConflictCopy(note('old', '# \n\nx'), { newId: 'new', label: 'telefon', date: '2026-10-31' });
  assert.match(copy, /^# \(çakışma - telefon - 2026-10-31\)$/m);
});

// ---------- rules ----------

test('same note on both sides, unchanged: nothing to do', () => {
  const r = plan({ n: h('1') }, { n: h('1') }, { n: h('1') }, opts());
  assert.deepEqual(r.actions, []);
  assert.deepEqual(r.nextBase, { n: h('1') });
});

test('same content on both sides but no history (first sync): nothing to do, no fake conflict', () => {
  const r = plan({ n: h('1') }, { n: h('1') }, {}, opts());
  assert.deepEqual(r.actions, []);
});

test('new on desktop only: copied to phone', () => {
  const r = plan({ n: h('1') }, {}, {}, opts());
  assert.deepEqual(r.actions, [{ type: 'copy', id: 'n', from: 'a', to: 'b' }]);
});

test('new on phone only: copied to desktop', () => {
  const r = plan({}, { n: h('1') }, {}, opts());
  assert.deepEqual(r.actions, [{ type: 'copy', id: 'n', from: 'b', to: 'a' }]);
});

test('only desktop edited: desktop wins', () => {
  const r = plan({ n: h('2') }, { n: h('1') }, { n: h('1') }, opts());
  assert.deepEqual(r.actions, [{ type: 'update', id: 'n', from: 'a', to: 'b' }]);
  assert.deepEqual(r.nextBase, { n: h('2') });
});

test('only phone edited: phone wins', () => {
  const r = plan({ n: h('1') }, { n: h('2') }, { n: h('1') }, opts());
  assert.deepEqual(r.actions, [{ type: 'update', id: 'n', from: 'b', to: 'a' }]);
});

test('both edited: conflict, neither side is overwritten', () => {
  const r = plan({ n: h('A') }, { n: h('B') }, { n: h('1') }, opts());
  assert.equal(r.actions.length, 1);
  const c = r.actions[0];
  assert.equal(c.type, 'conflict');
  assert.equal(c.id, 'n');
  assert.equal(c.keep, 'a');
  assert.equal(c.copyFrom, 'b');
  assert.ok(c.copyId);
  assert.deepEqual(r.nextBase.n, h('A'));
});

test('both sides wrote the same id with different text and there is no history: conflict, not a silent overwrite', () => {
  const r = plan({ n: h('A') }, { n: h('B') }, {}, opts());
  assert.equal(r.actions[0].type, 'conflict');
});

test('deleted on desktop, phone untouched: deleted on phone too', () => {
  const r = plan({ n: del }, { n: h('1') }, { n: h('1') }, opts());
  assert.deepEqual(r.actions, [{ type: 'delete', id: 'n', on: 'b' }]);
  assert.deepEqual(r.nextBase, { n: del });
});

test('deleted on phone, desktop untouched: deleted on desktop too', () => {
  const r = plan({ n: h('1') }, { n: del }, { n: h('1') }, opts());
  assert.deepEqual(r.actions, [{ type: 'delete', id: 'n', on: 'a' }]);
});

test('deleted on desktop but phone edited it afterwards: note comes back', () => {
  const r = plan({ n: del }, { n: h('2') }, { n: h('1') }, opts());
  assert.deepEqual(r.actions, [{ type: 'restore', id: 'n', from: 'b', to: 'a' }]);
  assert.deepEqual(r.nextBase, { n: h('2') });
});

test('deleted on phone but desktop edited it afterwards: note comes back', () => {
  const r = plan({ n: h('2') }, { n: del }, { n: h('1') }, opts());
  assert.deepEqual(r.actions, [{ type: 'restore', id: 'n', from: 'a', to: 'b' }]);
});

test('deleted on one side and we have no history for the other: keep the text (safe side)', () => {
  const r = plan({ n: del }, { n: h('1') }, {}, opts());
  assert.equal(r.actions[0].type, 'restore');
});

test('deleted on both sides: nothing to do, deletion remembered', () => {
  const r = plan({ n: del }, { n: del }, { n: h('1') }, opts());
  assert.deepEqual(r.actions, []);
  assert.deepEqual(r.nextBase, { n: del });
});

test('deleted on one side, other side never had it: nothing to do', () => {
  const r = plan({ n: del }, {}, {}, opts());
  assert.deepEqual(r.actions, []);
});

test('many notes at once, each decided on its own, in a stable order', () => {
  const r = plan(
    { b: h('1'), a: h('2'), c: h('9') },
    { b: h('1'), a: h('1'), d: h('5') },
    { b: h('1'), a: h('1') },
    opts(),
  );
  assert.deepEqual(r.actions.map((x) => `${x.id}:${x.type}`), ['a:update', 'c:copy', 'd:copy']);
});

// ---------- whole-sync simulation ----------
// Two in-memory "devices". Applies the plan like a real executor would, then checks the promises that matter:
// both sides end up identical, a second sync does nothing, and no text that anyone wrote is lost.

function device(files) {
  return { files: new Map(Object.entries(files)), dead: new Set() };
}

function snapshot(d) {
  const s = {};
  for (const [id, text] of d.files) s[id] = { hash: hashNote(text) };
  for (const id of d.dead) s[id] = { deleted: true };
  return s;
}

function sync(a, b, base, label = 'telefon', date = '2026-10-31') {
  let id = 0;
  const { actions, nextBase } = plan(snapshot(a), snapshot(b), base, { newId: () => `copy-${++id}-${a.files.size}${b.files.size}` });
  const dev = { a, b };
  for (const x of actions) {
    if (x.type === 'copy' || x.type === 'update' || x.type === 'restore') {
      dev[x.to].files.set(x.id, dev[x.from].files.get(x.id));
      dev[x.to].dead.delete(x.id);
    } else if (x.type === 'delete') {
      dev[x.on].files.delete(x.id);
      dev[x.on].dead.add(x.id);
    } else if (x.type === 'conflict') {
      const loser = b.files.get(x.id);
      const copy = makeConflictCopy(loser, { newId: x.copyId, label, date });
      b.files.set(x.id, a.files.get(x.id));
      a.files.set(x.copyId, copy);
      b.files.set(x.copyId, copy);
      nextBase[x.copyId] = { hash: hashNote(copy) };
    }
  }
  return { actions, nextBase };
}

const same = (a, b) => assert.deepEqual([...a.files].sort(), [...b.files].sort());

test('simulation: edits on both sides, new notes on both sides, one deletion - everything converges', () => {
  const pc = device({ one: note('one', '# One\npc v1'), two: note('two', '# Two\nv1'), gone: note('gone', '# Gone') });
  const phone = device({});
  let { nextBase: base } = sync(pc, phone, {});
  same(pc, phone);

  // PC edits "one", phone edits "two", phone writes a new note, PC deletes "gone".
  pc.files.set('one', note('one', '# One\npc v2'));
  phone.files.set('two', note('two', '# Two\nphone v2'));
  phone.files.set('fresh', note('fresh', '# Fresh\nwritten on phone'));
  pc.files.delete('gone'); pc.dead.add('gone');

  ({ nextBase: base } = sync(pc, phone, base));
  same(pc, phone);
  assert.match(pc.files.get('one'), /pc v2/);
  assert.match(pc.files.get('two'), /phone v2/);
  assert.ok(pc.files.has('fresh'));
  assert.ok(!pc.files.has('gone') && !phone.files.has('gone'));

  // A second sync right away must do nothing.
  const again = sync(pc, phone, base);
  assert.deepEqual(again.actions, []);
});

test('simulation: conflict keeps both texts and converges', () => {
  const pc = device({ n: note('n', '# Plan\nstart') });
  const phone = device({});
  let { nextBase: base } = sync(pc, phone, {});

  pc.files.set('n', note('n', '# Plan\nPC wrote this'));
  phone.files.set('n', note('n', '# Plan\nPHONE wrote this'));
  ({ nextBase: base } = sync(pc, phone, base));

  same(pc, phone);
  const all = [...pc.files.values()].join('\n');
  assert.match(all, /PC wrote this/);
  assert.match(all, /PHONE wrote this/);
  assert.equal(pc.files.size, 2);
  assert.match(pc.files.get('n'), /PC wrote this/);

  const again = sync(pc, phone, base);
  assert.deepEqual(again.actions, [], 'no repeat conflict on the next sync');
});

test('simulation: phone clock far in the past or future does not change who wins', () => {
  const pc = device({ n: note('n', '# N\nv1', { updated: '2026-10-31T10:00:00Z' }) });
  const phone = device({});
  let { nextBase: base } = sync(pc, phone, {});
  // PC edits (real time), phone's clock is a year ahead but it did not edit.
  pc.files.set('n', note('n', '# N\nv2 from pc', { updated: '2026-10-31T11:00:00Z' }));
  phone.files.set('n', note('n', '# N\nv1', { updated: '2027-10-31T11:00:00Z' }));
  sync(pc, phone, base);
  assert.match(phone.files.get('n'), /v2 from pc/);
});

test('simulation: deleted on PC, phone edits it before syncing: phone text survives', () => {
  const pc = device({ n: note('n', '# N\nv1') });
  const phone = device({});
  let { nextBase: base } = sync(pc, phone, {});
  pc.files.delete('n'); pc.dead.add('n');
  phone.files.set('n', note('n', '# N\nphone kept writing'));
  sync(pc, phone, base);
  same(pc, phone);
  assert.match(pc.files.get('n'), /phone kept writing/);
});

test('simulation: two conflicts in a row, nothing piles up wrongly', () => {
  const pc = device({ n: note('n', '# N\nv1') });
  const phone = device({});
  let { nextBase: base } = sync(pc, phone, {});
  for (const round of [1, 2]) {
    pc.files.set('n', note('n', `# N\npc round ${round}`));
    phone.files.set('n', note('n', `# N\nphone round ${round}`));
    ({ nextBase: base } = sync(pc, phone, base, 'telefon', `2026-10-3${round}`));
    same(pc, phone);
  }
  assert.equal(pc.files.size, 3);
  const all = [...pc.files.values()].join('\n');
  for (const t of ['phone round 1', 'phone round 2', 'pc round 2']) assert.match(all, new RegExp(t));
});
