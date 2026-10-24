const fs = require('fs');
const path = require('path');
const { PROVIDERS, AiError } = require('./providers');
const { buildMessages } = require('./prompts');

const DEFAULT_HOST = 'http://127.0.0.1:11434';
const DEFAULT_MODELS = { ollama: 'gemma3:12b', claude: '', openai: '', gemini: '' };

// API keys are encrypted with the OS (DPAPI on Windows) and never sent to the UI: the UI only learns
// whether a key exists. `safeStorage` is injected so the rest of this file has no Electron dependency.
class Ai {
  constructor({ dir, safeStorage, readNote, getConfig, setConfig }) {
    this.keyFile = path.join(dir, 'keys.json');
    this.safe = safeStorage;
    this.readNote = readNote;
    this.getConfig = getConfig;
    this.setConfig = setConfig;
    this.jobs = new Map();
  }

  config() {
    const c = this.getConfig() || {};
    return {
      provider: PROVIDERS[c.provider] ? c.provider : 'ollama',
      models: { ...DEFAULT_MODELS, ...(c.models || {}) },
      ollamaHost: c.ollamaHost || DEFAULT_HOST,
    };
  }

  readKeys() {
    try {
      return JSON.parse(fs.readFileSync(this.keyFile, 'utf8'));
    } catch {
      return {};
    }
  }

  getKey(provider) {
    const enc = this.readKeys()[provider];
    if (!enc) return '';
    try {
      return this.safe.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      return '';
    }
  }

  setKey(provider, key) {
    if (!PROVIDERS[provider]?.needsKey) throw new AiError('BAD_PROVIDER');
    const keys = this.readKeys();
    if (key) {
      if (!this.safe.isEncryptionAvailable()) throw new AiError('NO_ENCRYPTION');
      keys[provider] = this.safe.encryptString(key.trim()).toString('base64');
    } else {
      delete keys[provider];
    }
    fs.mkdirSync(path.dirname(this.keyFile), { recursive: true });
    fs.writeFileSync(this.keyFile, JSON.stringify(keys));
  }

  status() {
    const c = this.config();
    const keys = this.readKeys();
    return {
      ...c,
      providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, local: p.local, needsKey: p.needsKey, hasKey: !!keys[id] })),
    };
  }

  setConfigPatch(patch) {
    const c = this.config();
    const next = { ...c };
    if (patch.provider && PROVIDERS[patch.provider]) next.provider = patch.provider;
    if (patch.models) next.models = { ...c.models, ...patch.models };
    if (patch.ollamaHost) {
      const url = new URL(patch.ollamaHost); // throws on garbage
      if (!/^https?:$/.test(url.protocol)) throw new AiError('BAD_HOST');
      next.ollamaHost = url.origin;
    }
    this.setConfig(next);
    return this.status();
  }

  ctx(provider) {
    const p = PROVIDERS[provider];
    if (!p) throw new AiError('BAD_PROVIDER');
    const key = p.needsKey ? this.getKey(provider) : '';
    if (p.needsKey && !key) throw new AiError('NO_KEY');
    return { p, key, host: this.config().ollamaHost };
  }

  async models(provider) {
    const { p, key, host } = this.ctx(provider);
    return p.models({ key, host });
  }

  // Runs one action. Tokens are pushed through send(channel, payload); resolves when the answer is complete.
  async run(id, { action, provider, model, input }, send) {
    const { p, key, host } = this.ctx(provider);
    let payload = input;
    if (action === 'compare') {
      const rels = Array.isArray(input.notes) ? input.notes : [];
      if (rels.length < 2) throw new AiError('NEED_TWO');
      payload = { notes: await Promise.all(rels.map(async (rel) => {
        const n = await this.readNote(rel);
        const heading = n.body.match(/^#\s+(.+)$/m);
        return { title: (heading ? heading[1] : path.basename(rel, '.md')).trim(), body: n.body };
      })) };
    } else if (typeof input?.text !== 'string' || !input.text.trim()) {
      throw new AiError('EMPTY');
    }

    const { messages, truncated } = buildMessages(action, payload);
    const controller = new AbortController();
    this.jobs.set(id, controller);
    send('ai:start', { id, truncated });
    try {
      await p.chat({ key, host, model, messages, signal: controller.signal, onToken: (text) => send('ai:token', { id, text }) });
      send('ai:done', { id });
    } catch (err) {
      if (err.code === 'ABORTED' || controller.signal.aborted) send('ai:done', { id, stopped: true });
      else send('ai:error', { id, code: err.code || 'UNKNOWN', message: err.message });
    } finally {
      this.jobs.delete(id);
    }
  }

  stop(id) {
    this.jobs.get(id)?.abort();
  }
}

module.exports = { Ai, DEFAULT_MODELS };
