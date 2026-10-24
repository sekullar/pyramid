// Small helpers for reading streamed HTTP responses line by line.

class AiError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

async function* lines(res) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i = buf.indexOf('\n');
    while (i >= 0) {
      yield buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      i = buf.indexOf('\n');
    }
  }
  if (buf.trim()) yield buf;
}

// Server-sent events: yields the payload of each "data:" line (without the "[DONE]" marker).
async function* sseData(res) {
  for await (const line of lines(res)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data && data !== '[DONE]') yield data;
  }
}

async function post(url, { headers = {}, body, signal }) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new AiError('ABORTED');
    throw new AiError('UNREACHABLE', err.cause?.code || err.message);
  }
  await assertOk(res);
  return res;
}

async function getJson(url, { headers = {}, timeout = 8000 } = {}) {
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  } catch (err) {
    throw new AiError('UNREACHABLE', err.cause?.code || err.message);
  }
  await assertOk(res);
  return res.json();
}

async function assertOk(res) {
  if (res.ok) return;
  let detail = '';
  try {
    const data = await res.json();
    detail = data?.error?.message || data?.error || data?.message || '';
  } catch {}
  throw new AiError(`HTTP_${res.status}`, typeof detail === 'string' ? detail : JSON.stringify(detail));
}

module.exports = { AiError, lines, sseData, post, getJson };
