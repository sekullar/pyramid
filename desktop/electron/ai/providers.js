const { AiError, lines, sseData, post, getJson } = require('./stream');

// Every provider takes the same chat messages ([{ role: 'system' | 'user' | 'assistant', content }]) and
// calls onToken(text) as the answer streams in. No Electron imports here, so it can be tested with plain Node.

const MODEL_ID = /^[\w.\-:/]+$/;

function checkModel(model) {
  if (!model) throw new AiError('NO_MODEL');
  if (!MODEL_ID.test(model)) throw new AiError('BAD_MODEL', model);
}

function splitSystem(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  return { system, rest: messages.filter((m) => m.role !== 'system') };
}

const ollama = {
  local: true,
  needsKey: false,
  async models({ host }) {
    const data = await getJson(`${host}/api/tags`, { timeout: 4000 });
    return (data.models || [])
      .filter((m) => !(m.capabilities || []).includes('embedding') || (m.capabilities || []).includes('completion'))
      .map((m) => m.name)
      .sort();
  },
  async chat({ host, model, messages, signal, onToken }) {
    checkModel(model);
    // Ollama's default context is small and silently cuts long input, so ask for a bigger one.
    const res = await post(`${host}/api/chat`, { body: { model, messages, stream: true, options: { num_ctx: 16384 } }, signal });
    for await (const line of lines(res)) {
      if (!line.trim()) continue;
      const data = JSON.parse(line);
      if (data.error) throw new AiError('PROVIDER', data.error);
      const text = data.message?.content; // "thinking" tokens live in message.thinking and are skipped on purpose
      if (text) onToken(text);
    }
  },
};

const claude = {
  local: false,
  needsKey: true,
  base: 'https://api.anthropic.com',
  headers: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
  async models({ key, base = this.base }) {
    const data = await getJson(`${base}/v1/models?limit=100`, { headers: this.headers(key) });
    return (data.data || []).map((m) => m.id);
  },
  async chat({ key, base = this.base, model, messages, signal, onToken }) {
    checkModel(model);
    const { system, rest } = splitSystem(messages);
    const res = await post(`${base}/v1/messages`, {
      headers: this.headers(key),
      body: { model, max_tokens: 8192, system, messages: rest, stream: true },
      signal,
    });
    for await (const data of sseData(res)) {
      const event = JSON.parse(data);
      if (event.type === 'error') throw new AiError('PROVIDER', event.error?.message);
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') onToken(event.delta.text);
    }
  },
};

const openai = {
  local: false,
  needsKey: true,
  base: 'https://api.openai.com',
  async models({ key, base = this.base }) {
    const data = await getJson(`${base}/v1/models`, { headers: { Authorization: `Bearer ${key}` } });
    return (data.data || [])
      .map((m) => m.id)
      .filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(embed|audio|image|tts|whisper|realtime|transcribe|moderation|search|instruct)/.test(id))
      .sort();
  },
  async chat({ key, base = this.base, model, messages, signal, onToken }) {
    checkModel(model);
    const res = await post(`${base}/v1/chat/completions`, {
      headers: { Authorization: `Bearer ${key}` },
      body: { model, messages, stream: true },
      signal,
    });
    for await (const data of sseData(res)) {
      const event = JSON.parse(data);
      if (event.error) throw new AiError('PROVIDER', event.error.message);
      const text = event.choices?.[0]?.delta?.content;
      if (text) onToken(text);
    }
  },
};

const gemini = {
  local: false,
  needsKey: true,
  base: 'https://generativelanguage.googleapis.com',
  async models({ key, base = this.base }) {
    const data = await getJson(`${base}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
    return (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .sort();
  },
  async chat({ key, base = this.base, model, messages, signal, onToken }) {
    checkModel(model);
    const { system, rest } = splitSystem(messages);
    const res = await post(`${base}/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
      headers: { 'x-goog-api-key': key },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: rest.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      },
      signal,
    });
    for await (const data of sseData(res)) {
      const event = JSON.parse(data);
      if (event.error) throw new AiError('PROVIDER', event.error.message);
      for (const part of event.candidates?.[0]?.content?.parts || []) if (part.text) onToken(part.text);
    }
  },
};

const PROVIDERS = { ollama, claude, openai, gemini };

module.exports = { PROVIDERS, AiError };
