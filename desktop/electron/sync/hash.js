const crypto = require('crypto');

// Same front matter shape as notes.js: id / created / updated / tags.
const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function split(raw) {
  const match = raw.match(FM);
  if (!match) return { meta: {}, body: raw };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: raw.slice(match[0].length) };
}

// Fingerprint of what the user wrote: body + tags. `updated` and `created` are left out on purpose, otherwise
// merely re-saving (or syncing) a note would look like an edit. Line endings are normalised so Windows and
// Android agree.
function hashNote(raw) {
  const { meta, body } = split(raw);
  const text = `${(meta.tags || '').replace(/\s+/g, '')}\n${body.replace(/\r\n/g, '\n')}`;
  return crypto.createHash('sha256').update(text).digest('hex');
}

function idOf(raw) {
  return split(raw).meta.id || null;
}

// The copy made for the losing side of a conflict: new id, and the title gets a suffix like
// "Title (çakışma - telefon - 2026-10-31)". Title = first "# " heading, as in notes.js.
function makeConflictCopy(raw, { newId, label, date, word = 'çakışma' }) {
  const { meta, body } = split(raw);
  const stamp = `(${word} - ${label} - ${date})`;
  const heading = /^#[ \t]+(.*)$/m;
  const nextBody = heading.test(body)
    ? body.replace(heading, (_m, title) => `# ${title.trim()} ${stamp}`.replace(/^# {2}/, '# '))
    : `# ${stamp}\n\n${body}`;
  const now = new Date().toISOString();
  return `---\nid: ${newId}\ncreated: ${meta.created || now}\nupdated: ${now}\ntags: [${(meta.tags || '').replace(/^\[|\]$/g, '')}]\n---\n${nextBody}`;
}

// Undoes makeConflictCopy: the copy's text under the original note's id, title without the conflict mark.
function restoreFromCopy(copyRaw, origId, origRaw) {
  const { meta, body } = split(copyRaw);
  const orig = origRaw ? split(origRaw).meta : {};
  const now = new Date().toISOString();
  const mark = /[ \t]*\((?:çakışma|conflict) - [^)]*? - \d{4}-\d{2}-\d{2}\)[ \t]*$/m;
  const clean = body.replace(mark, '').replace(/^#$/m, '# ');
  const tags = (meta.tags || '').replace(/^\[|\]$/g, '');
  return `---\nid: ${origId}\ncreated: ${orig.created || meta.created || now}\nupdated: ${now}\ntags: [${tags}]\n---\n${clean}`;
}

// The text after the front matter.
const bodyOf = (raw) => split(raw).body;

module.exports = { hashNote, idOf, makeConflictCopy, restoreFromCopy, bodyOf };

// Same note, new text: keeps id/created/tags, bumps updated.
function withBody(raw, body) {
  const { meta } = split(raw);
  const tags = (meta.tags || '').replace(/^\[|\]$/g, '');
  return `---\nid: ${meta.id}\ncreated: ${meta.created || new Date().toISOString()}\nupdated: ${new Date().toISOString()}\ntags: [${tags}]\n---\n${body}`;
}

module.exports.withBody = withBody;
