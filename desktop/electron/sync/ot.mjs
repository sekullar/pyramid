// Letter-by-letter live typing: the text operations both sides agree on.
//
// An operation is a list of primitives applied one after the other:
//   ['i', pos, 'text']   insert at pos
//   ['d', pos, count]    delete `count` characters at pos
// Positions are UTF-16 code units (JS string indices, Kotlin String indices), so both sides count the same way.
//
// The desktop keeps the one true copy of an open note and numbers every change (`rev`). A device sends its change
// together with the `rev` it last saw; the desktop moves it past everything that happened since (xform) and applies it.
// This file is imported by the app's main process, by the editor window, and by tests. The phone has the same rules in
// LiveText.kt, pinned by shared test vectors.

const ins = (p, s) => ['i', p, s];
const del = (p, n) => ['d', p, n];

// a and b are single primitives made against the same text. Returns [a', b']: a' applies after b, b' after a.
// When both insert at the same place, a (the server side) goes first.
function xp(a, b) {
  if (a[0] === 'i' && b[0] === 'i') {
    if (a[1] <= b[1]) return [[a], [ins(b[1] + a[2].length, b[2])]];
    return [[ins(a[1] + b[2].length, a[2])], [b]];
  }
  if (a[0] === 'i') {
    const [, p, s] = a;
    const [, q, n] = b;
    if (p <= q) return [[a], [del(q + s.length, n)]];
    if (p >= q + n) return [[ins(p - n, s)], [b]];
    const k = p - q; // the insert lands inside the deleted part: the delete splits around it
    return [[ins(q, s)], [del(q, k), del(q + s.length, n - k)]];
  }
  if (b[0] === 'i') {
    const [bl, al] = xp(b, a);
    return [al, bl];
  }
  const [, p, n] = a;
  const [, q, m] = b;
  const overlap = Math.max(0, Math.min(p + n, q + m) - Math.max(p, q));
  const moved = (from, otherFrom, otherLen) => (from >= otherFrom + otherLen ? from - otherLen : from >= otherFrom ? otherFrom : from);
  const aLen = n - overlap;
  const bLen = m - overlap;
  return [aLen > 0 ? [del(moved(p, q, m), aLen)] : [], bLen > 0 ? [del(moved(q, p, n), bLen)] : []];
}

// Lists of primitives: returns [A', B'].
export function xform(A, B) {
  if (A.length === 0 || B.length === 0) return [A, B];
  if (A.length === 1 && B.length === 1) return xp(A[0], B[0]);
  if (A.length > 1) {
    const [a1, b1] = xform([A[0]], B);
    const [rest, b2] = xform(A.slice(1), b1);
    return [a1.concat(rest), b2];
  }
  const [a1, b1] = xform(A, [B[0]]);
  const [a2, rest] = xform(a1, B.slice(1));
  return [a2, b1.concat(rest)];
}

export function apply(text, ops) {
  let out = text;
  for (const [type, p, x] of ops) {
    out = type === 'i' ? out.slice(0, p) + x + out.slice(p) : out.slice(0, p) + out.slice(p + x);
  }
  return out;
}

// True when every primitive fits the text it is applied to. Used on whatever a device sends.
export function valid(text, ops) {
  if (!Array.isArray(ops) || ops.length > 8) return false;
  let len = text.length;
  for (const op of ops) {
    if (!Array.isArray(op) || op.length !== 3) return false;
    const [type, p, x] = op;
    if (!Number.isInteger(p) || p < 0 || p > len) return false;
    if (type === 'i') {
      if (typeof x !== 'string' || x.length === 0) return false;
      len += x.length;
    } else if (type === 'd') {
      if (!Number.isInteger(x) || x <= 0 || p + x > len) return false;
      len -= x;
    } else return false;
  }
  return true;
}

const isHigh = (c) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c) => c >= 0xdc00 && c <= 0xdfff;

// The one change that turns `a` into `b` (common start and end kept). Never cuts an emoji in half.
export function diffOps(a, b) {
  if (a === b) return [];
  const limit = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < limit && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix++;
  if (prefix > 0 && isHigh(a.charCodeAt(prefix - 1))) prefix--;
  let suffix = 0;
  while (suffix < limit - prefix && a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix)) suffix++;
  while (suffix > 0 && isLow(a.charCodeAt(a.length - suffix))) suffix--;
  const removed = a.length - prefix - suffix;
  const added = b.slice(prefix, b.length - suffix);
  const ops = [];
  if (removed > 0) ops.push(del(prefix, removed));
  if (added.length > 0) ops.push(ins(prefix, added));
  return ops;
}

// Cheap fingerprint both sides can compute to notice that their copies drifted apart (FNV-1a over UTF-16 units).
export function checksum(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export class LiveDesync extends Error {}

// One device's side of a live note. Transport-agnostic: the caller sends what prepare() returns and hands the reply to
// receive(). `local` is always the text currently in the editor.
export class LiveClient {
  constructor(cid) {
    this.cid = cid;
    this.seq = 0;
    this.open('', -1, '');
  }

  // Start (or restart) from the desktop's copy. Whatever the editor holds that differs becomes our first change.
  open(text, rev, epoch) {
    this.base = text; // the desktop's text as of `rev`
    this.rev = rev;
    this.epoch = epoch;
    this.inflight = null;
    this.sentText = text;
  }

  // What to send now. ops is empty for a plain "anything new?" poll.
  prepare(local) {
    const ops = diffOps(this.base, local);
    this.sentText = local;
    this.inflight = ops.length ? ops : null;
    if (ops.length) this.seq += 1;
    return { cid: this.cid, ep: this.epoch, rev: this.rev, ops, seq: ops.length ? this.seq : 0 };
  }

  // The desktop's reply: {rev, entries, len, cs}. Returns the editor's new text (same as `local` if nothing came in).
  receive(reply, local) {
    let s = this.inflight || [];
    let base = this.base;
    const incoming = [];
    for (const h of reply.entries) {
      const [h2, s2] = xform(h, s);
      incoming.push(h2);
      s = s2;
      base = apply(base, h);
    }
    base = apply(base, s);
    if (base.length !== reply.len || checksum(base) !== reply.cs) throw new LiveDesync('copies differ');
    // Edits made while the request was in flight sit on top of what we sent; the incoming changes go around them.
    let e = diffOps(this.sentText, local);
    let text = local;
    for (const h2 of incoming) {
      const [h3, e2] = xform(h2, e);
      text = apply(text, h3);
      e = e2;
    }
    this.base = base;
    this.rev = reply.rev;
    this.inflight = null;
    return text;
  }
}
