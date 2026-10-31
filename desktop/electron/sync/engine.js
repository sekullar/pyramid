const crypto = require('crypto');

// Pure sync decision engine. It never touches files or the network: give it what each side has and what both
// agreed on last time, get back a list of actions. The transport (own Wi-Fi server, Phoneix bridge) only has to
// carry the actions out.
//
//   a, b : { [noteId]: { hash } | { deleted: true } }   what each side has now (deleted = tombstone)
//   base : { [noteId]: { hash } | { deleted: true } }   what both sides agreed on at the last sync
//
// "Changed" always means "hash differs from base", never "newer timestamp", so a wrong phone clock cannot make
// the wrong note win. Side `a` is the one whose version keeps the note id in a conflict (use the desktop);
// the other side's version is saved next to it as a new note, so nothing is ever overwritten.
//
// Actions:
//   { type: 'copy',     id, from, to }   note exists only on `from`
//   { type: 'update',   id, from, to }   only `from` changed it since the last sync
//   { type: 'restore',  id, from, to }   `to` deleted it, but `from` edited it afterwards: it comes back
//   { type: 'delete',   id, on }         one side deleted it and the other did not touch it
//   { type: 'conflict', id, copyId, keep: 'a', copyFrom: 'b' }
//        both changed it: `a`'s version stays at `id` on both sides, `b`'s version becomes a new note `copyId` on both.
//
// nextBase is the agreed state if every action succeeds. Conflict copies are not in it: the executor adds
// nextBase[copyId] = { hash } after it has created the copy (its hash differs because the title changed).

const stateOf = (e) => (!e ? 'absent' : e.deleted ? 'deleted' : 'present');

function plan(a, b, base = {}, opts = {}) {
  const newId = opts.newId || (() => crypto.randomUUID());
  const actions = [];
  const nextBase = {};
  const ids = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();

  for (const id of ids) {
    const ea = a[id];
    const eb = b[id];
    const sa = stateOf(ea);
    const sb = stateOf(eb);
    const baseHash = base[id] && !base[id].deleted ? base[id].hash : undefined;

    if (sa === 'absent' && sb === 'absent') continue;

    // Nothing live on either side: remember the deletion so it is not mistaken for "never existed" later.
    if (sa !== 'present' && sb !== 'present') {
      nextBase[id] = { deleted: true };
      continue;
    }

    // Only one side has the note and the other never knew it.
    if (sa === 'present' && sb === 'absent') {
      actions.push({ type: 'copy', id, from: 'a', to: 'b' });
      nextBase[id] = { hash: ea.hash };
      continue;
    }
    if (sa === 'absent' && sb === 'present') {
      actions.push({ type: 'copy', id, from: 'b', to: 'a' });
      nextBase[id] = { hash: eb.hash };
      continue;
    }

    // One side deleted it, the other still has it.
    if (sa === 'deleted' || sb === 'deleted') {
      const alive = sa === 'present' ? 'a' : 'b';
      const gone = alive === 'a' ? 'b' : 'a';
      const liveHash = (alive === 'a' ? ea : eb).hash;
      if (baseHash !== undefined && liveHash === baseHash) {
        actions.push({ type: 'delete', id, on: alive });
        nextBase[id] = { deleted: true };
      } else {
        // Edited after the other side deleted it (or we cannot prove it was not): keep the text.
        actions.push({ type: 'restore', id, from: alive, to: gone });
        nextBase[id] = { hash: liveHash };
      }
      continue;
    }

    // Both sides have it.
    if (ea.hash === eb.hash) {
      nextBase[id] = { hash: ea.hash };
      continue;
    }
    const aChanged = ea.hash !== baseHash;
    const bChanged = eb.hash !== baseHash;
    if (aChanged && !bChanged) {
      actions.push({ type: 'update', id, from: 'a', to: 'b' });
      nextBase[id] = { hash: ea.hash };
    } else if (bChanged && !aChanged) {
      actions.push({ type: 'update', id, from: 'b', to: 'a' });
      nextBase[id] = { hash: eb.hash };
    } else {
      // Both changed, or there is no common ancestor to compare against.
      actions.push({ type: 'conflict', id, copyId: newId(), keep: 'a', copyFrom: 'b' });
      nextBase[id] = { hash: ea.hash };
    }
  }

  return { actions, nextBase };
}

module.exports = { plan };
