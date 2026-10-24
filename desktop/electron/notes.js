const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { shell } = require('electron');

// A note is a Markdown file. Its front matter carries what sync needs later:
//   ---
//   id: <uuid>
//   created: <iso>
//   updated: <iso>
//   tags: [a, b]
//   ---
const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parse(raw) {
  const match = raw.match(FM);
  const meta = {};
  let body = raw;
  if (match) {
    body = raw.slice(match[0].length);
    for (const line of match[1].split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const key = line.slice(0, i).trim();
      const value = line.slice(i + 1).trim();
      meta[key] = key === 'tags'
        ? value.replace(/^\[|\]$/g, '').split(',').map((t) => t.trim()).filter(Boolean)
        : value;
    }
  }
  return { meta, body };
}

function serialize(meta, body) {
  const tags = (meta.tags || []).join(', ');
  return `---\nid: ${meta.id}\ncreated: ${meta.created}\nupdated: ${meta.updated}\ntags: [${tags}]\n---\n${body}`;
}

function titleOf(body, file) {
  const heading = body.match(/^#\s+(.+)$/m);
  return (heading ? heading[1] : path.basename(file, '.md')).trim().slice(0, 120);
}

class Notes {
  constructor(getDir) {
    this.getDir = getDir;
  }

  // Resolves a relative note path and refuses anything that escapes the notes folder.
  resolve(rel) {
    const root = path.resolve(this.getDir());
    const full = path.resolve(root, rel);
    if (full !== root && !full.startsWith(root + path.sep)) throw new Error('Path outside the notes folder');
    return full;
  }

  ensureDir() {
    fs.mkdirSync(this.getDir(), { recursive: true });
  }

  list() {
    this.ensureDir();
    const root = path.resolve(this.getDir());
    const out = [];
    const walk = (dir, depth) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (depth < 4) walk(full, depth + 1);
        } else if (/\.md$/i.test(entry.name)) {
          try {
            const { meta, body } = parse(fs.readFileSync(full, 'utf8'));
            const rel = path.relative(root, full).split(path.sep).join('/');
            out.push({
              path: rel,
              notebook: path.dirname(rel) === '.' ? '' : path.dirname(rel),
              title: titleOf(body, entry.name),
              preview: body.replace(/^#.*$/m, '').replace(/\s+/g, ' ').trim().slice(0, 140),
              tags: meta.tags || [],
              updated: meta.updated || fs.statSync(full).mtime.toISOString(),
            });
          } catch {}
        }
      }
    };
    walk(root, 0);
    return out.sort((a, b) => b.updated.localeCompare(a.updated));
  }

  read(rel) {
    const full = this.resolve(rel);
    const { meta, body } = parse(fs.readFileSync(full, 'utf8'));
    return { path: rel, meta, body };
  }

  // Writes a note, adding front matter on first save so notes created elsewhere get an id too.
  save(rel, body) {
    const full = this.resolve(rel);
    const existing = fs.existsSync(full) ? parse(fs.readFileSync(full, 'utf8')).meta : {};
    const now = new Date().toISOString();
    const meta = {
      id: existing.id || crypto.randomUUID(),
      created: existing.created || now,
      updated: now,
      tags: existing.tags || [],
    };
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, serialize(meta, body));
    return { path: rel, updated: now };
  }

  create(notebook = '') {
    this.ensureDir();
    const dir = this.resolve(notebook);
    fs.mkdirSync(dir, { recursive: true });
    let name = 'Untitled.md';
    for (let i = 2; fs.existsSync(path.join(dir, name)); i += 1) name = `Untitled ${i}.md`;
    const rel = path.posix.join(notebook, name);
    this.save(rel, '# \n\n');
    return rel;
  }

  // Goes to the Recycle Bin instead of deleting for good.
  async remove(rel) {
    await shell.trashItem(this.resolve(rel));
  }
}

module.exports = { Notes };
