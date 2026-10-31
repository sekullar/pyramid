const fs = require('fs');
const os = require('os');
const path = require('path');

// "Sync with Phoneix": Phoneix is a separate app that is already paired with the phone. Instead of a second QR code,
// Pyramid hands its pairing link to Phoneix's local API (see Phoneix PROTOCOL.md: POST /link), Phoneix carries it to the
// phone over its own encrypted connection and opens it in Pyramid there, where the user confirms once.
// After that the two Pyramids sync directly, exactly as with a QR pairing.
//
// Phoneix writes ~/.dynbar-ecosystem/phoneix.json while it runs: {app, port, token, pid, paired, phone}.
const INFO_FILE = path.join(os.homedir(), '.dynbar-ecosystem', 'phoneix.json');

function readInfo(file = INFO_FILE) {
  try {
    const info = JSON.parse(fs.readFileSync(file, 'utf8'));
    let running = false;
    try {
      process.kill(info.pid, 0);
      running = true;
    } catch {}
    return { found: true, running, paired: !!info.paired, phone: typeof info.phone === 'string' ? info.phone : '', port: info.port, token: info.token };
  } catch {
    return { found: false, running: false, paired: false, phone: '', port: 0, token: '' };
  }
}

// What the window may see: no port, no token.
const publicInfo = (info) => ({ found: info.found, running: info.running, paired: info.paired, phone: info.phone });

// Throws Error(code): PHONEIX_DOWN | PHONEIX_UNPAIRED | PHONEIX_OLD (this Phoneix has no /link yet) | PHONEIX_REFUSED.
async function sendPairLink(info, url, fetchFn = fetch) {
  if (!info.found || !info.running || !info.port || !info.token) throw new Error('PHONEIX_DOWN');
  if (!info.paired) throw new Error('PHONEIX_UNPAIRED');
  let res;
  try {
    res = await fetchFn(`http://127.0.0.1:${info.port}/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${info.token}` },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    throw new Error('PHONEIX_DOWN');
  }
  if (res.ok) return;
  const body = await res.json().catch(() => ({}));
  if (res.status === 409) throw new Error('PHONEIX_UNPAIRED');
  if (res.status === 404 && !body.error) throw new Error('PHONEIX_OLD');
  throw new Error('PHONEIX_REFUSED');
}

module.exports = { readInfo, publicInfo, sendPairLink, INFO_FILE };
