const crypto = require('crypto');

// Same wire format as Phoneix: base64( nonce(12) | ciphertext | tag(16) ), AES-256-GCM. Only the AAD differs,
// so a Phoneix message can never be replayed against Pyramid or the other way round.
const AAD = Buffer.from('pyramid1');
const MAX_AGE_MS = 60_000;

const newKey = () => crypto.randomBytes(32);

function seal(key, obj) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(AAD);
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, ct, cipher.getAuthTag()]).toString('base64');
}

// Returns { nonce, msg } or throws. `t` (ms) inside the message must be recent.
function open(key, b64, now = Date.now()) {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 12 + 16) throw new Error('short');
  const nonce = buf.subarray(0, 12);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(AAD);
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  const pt = Buffer.concat([decipher.update(buf.subarray(12, buf.length - 16)), decipher.final()]);
  const msg = JSON.parse(pt.toString('utf8'));
  if (typeof msg.t !== 'number' || Math.abs(now - msg.t) > MAX_AGE_MS) throw new Error('stale');
  return { nonce: nonce.toString('hex'), msg };
}

module.exports = { newKey, seal, open, MAX_AGE_MS };
