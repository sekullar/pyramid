const fs = require('fs');
const path = require('path');
const { hashNote, idOf } = require('./hash');

// The notes folder as the sync code sees it: notes keyed by their front matter `id`.
// No Electron in here, so the same class runs in tests and in the app.
//
// Known limits for now: files without an `id` are skipped (Pyramid adds one the first time it saves a note),
// and a note that arrives from the other device is stored in the top folder, not in a notebook.
class Vault {
  // trash(fullPath): async, moves a file out of the notes folder. The app passes shell.trashItem (Recycle Bin);
  // the default moves it to `.sync-trash` inside the folder, so a deletion can always be undone.
  constructor(getDir, { trash } = {}) {
    this.getDir = getDir;
    this.trash = trash || ((full) => this.#moveToSyncTrash(full));
  }

  #moveToSyncTrash(full) {
    const dir = path.join(path.resolve(this.getDir()), '.sync-trash');
    fs.mkdirSync(dir, { recursive: true });
    fs.renameSync(full, path.join(dir, `${Date.now()}-${path.basename(full)}`));
  }

  scan() {
    const root = path.resolve(this.getDir());
    const out = new Map();
    if (!fs.existsSync(root)) return out;
    const walk = (dir, depth) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (depth < 4) walk(full, depth + 1);
        } else if (/\.md$/i.test(entry.name)) {
          try {
            const raw = fs.readFileSync(full, 'utf8');
            const id = idOf(raw);
            if (id && !out.has(id)) out.set(id, { full, raw, hash: hashNote(raw) });
          } catch {}
        }
      }
    };
    walk(root, 0);
    return out;
  }

  // What the engine needs: live notes with their hash, plus a tombstone for every note that was in sync
  // before (it is in `base`) but is no longer on disk. That is how a deletion is noticed without recording it.
  snapshot(base = {}) {
    const snap = {};
    const files = this.scan();
    for (const [id, f] of files) snap[id] = { hash: f.hash };
    for (const id of Object.keys(base)) {
      if (!files.has(id)) snap[id] = { deleted: true };
    }
    return snap;
  }

  read(id) {
    const f = this.scan().get(id);
    if (!f) throw new Error('no such note');
    return f.raw;
  }

  // Overwrites the note with this id, or creates a new file named after its title.
  write(id, raw) {
    const existing = this.scan().get(id);
    if (idOf(raw) !== id) throw new Error('note id does not match');
    const full = existing ? existing.full : this.#newPath(raw);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, raw);
  }

  async remove(id) {
    const f = this.scan().get(id);
    if (f) await this.trash(f.full);
  }

  #newPath(raw) {
    const root = path.resolve(this.getDir());
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    const heading = body.match(/^#[ \t]+(.+)$/m);
    // Keep letters/digits/space/dash/dot (incl. Turkish letters); everything else would be unsafe or ugly in a file name.
    const base = ((heading && heading[1]) || 'Untitled').replace(/[^\p{L}\p{N} ._()-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
    let name = `${base}.md`;
    for (let i = 2; fs.existsSync(path.join(root, name)); i += 1) name = `${base} ${i}.md`;
    return path.join(root, name);
  }
}

module.exports = { Vault };
