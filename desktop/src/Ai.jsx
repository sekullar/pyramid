import React, { useCallback, useEffect, useRef, useState } from 'react';

const PROVIDER_NAMES = { ollama: 'Ollama', claude: 'Claude', openai: 'OpenAI', gemini: 'Gemini' };
const TONES = ['clearer', 'shorter', 'formal', 'casual'];

function errorText(t, raw) {
  const code = String(raw || '');
  if (t.aiErrors[code]) return t.aiErrors[code];
  const http = code.match(/^HTTP_(\d+)/);
  if (http && t.aiErrors[`HTTP_${http[1]}`]) return t.aiErrors[`HTTP_${http[1]}`];
  return `${t.aiErrors.UNKNOWN}${code ? ` (${code})` : ''}`;
}

let counter = 0;

// One AI job at a time: start it, watch the streamed tokens, stop it.
export function useAi(t) {
  const [state, setState] = useState({ phase: 'idle', text: '', truncated: false, error: '', action: '' });
  const jobId = useRef(null);

  useEffect(() => window.pyramid.onAi((type, p) => {
    if (p.id !== jobId.current) return;
    setState((s) => {
      if (type === 'start') return { ...s, truncated: p.truncated };
      if (type === 'token') return { ...s, text: s.text + p.text };
      if (type === 'done') return { ...s, phase: 'done' };
      if (type === 'error') return { ...s, phase: 'error', error: errorText(t, p.code) + (p.code === 'PROVIDER' && p.message ? `: ${p.message}` : '') };
      return s;
    });
  }), [t]);

  const run = useCallback(async (action, input) => {
    const cfg = (await window.pyramid.aiStatus()).value;
    const id = `job${Date.now()}-${counter++}`;
    jobId.current = id;
    setState({ phase: 'running', text: '', truncated: false, error: '', action });
    const res = await window.pyramid.aiRun(id, { action, provider: cfg.provider, model: cfg.models[cfg.provider], input });
    if (!res.ok) setState((s) => ({ ...s, phase: 'error', error: errorText(t, res.error) }));
  }, [t]);

  const stop = useCallback(() => {
    if (jobId.current) window.pyramid.aiStop(jobId.current);
  }, []);

  const clear = useCallback(() => {
    jobId.current = null;
    setState({ phase: 'idle', text: '', truncated: false, error: '', action: '' });
  }, []);

  return { ...state, run, stop, clear };
}

export function useAiStatus() {
  const [status, setStatus] = useState(null);
  const load = useCallback(async () => {
    const res = await window.pyramid.aiStatus();
    if (res.ok) setStatus(res.value);
  }, []);
  useEffect(() => { load(); }, [load]);
  return [status, setStatus, load];
}

function ProviderLine({ status, onSettings, t }) {
  if (!status) return null;
  const p = status.providers.find((x) => x.id === status.provider);
  const model = status.models[status.provider];
  return (
    <div className="ai-where">
      <span className={`pill ${p.local ? 'local' : 'cloud'}`}>{p.local ? t.aiLocal : t.aiCloud}</span>
      <span className="ai-model">{PROVIDER_NAMES[p.id]} · {model || t.aiNoModel}</span>
      <button className="link" onClick={onSettings}>{t.settings}</button>
    </div>
  );
}

function Output({ ai, actions, t }) {
  if (ai.phase === 'idle') return null;
  return (
    <div className="ai-out">
      {ai.phase === 'running' && (
        <div className="ai-running">
          <span className="dots"><i /><i /><i /></span> {t.aiWorking}
          <button className="link" onClick={ai.stop}>{t.aiStop}</button>
        </div>
      )}
      {ai.truncated && <p className="warn">{t.aiTruncated}</p>}
      {ai.phase === 'error' && <p className="err">{ai.error}</p>}
      {ai.text && <pre className="ai-text">{ai.text}</pre>}
      {ai.phase !== 'running' && (
        <div className="ai-actions">
          {ai.phase === 'done' && ai.text && actions}
          <button onClick={ai.clear}>{t.aiDiscard}</button>
        </div>
      )}
    </div>
  );
}

// Side panel of the editor. `scope` is { text, start, end, whole } for the selection or the whole note.
export function AiPanel({ ai, status, scope, title, onApply, onSettings, onClose, t }) {
  const [tone, setTone] = useState('clearer');
  const busy = ai.phase === 'running';
  const ready = status && status.models[status.provider];
  const go = (action) => ai.run(action, { text: scope.text, title, tone, length: 'medium' });
  const copy = () => navigator.clipboard.writeText(ai.text);

  return (
    <div className="ai-panel">
      <div className="ai-head">
        <h3>{t.ai}</h3>
        <button className="link" onClick={onClose}>{t.close}</button>
      </div>
      <ProviderLine status={status} onSettings={onSettings} t={t} />
      <p className="ai-scope">{scope.whole ? t.aiScopeWhole : t.aiScopeSelection.replace('{n}', scope.text.length)}</p>
      <div className="ai-buttons">
        <button disabled={busy || !ready || !scope.text.trim()} onClick={() => go('summarize')}>{t.aiSummarize}</button>
        <button disabled={busy || !ready || !scope.text.trim()} onClick={() => go('fix')}>{t.aiFix}</button>
      </div>
      <div className="ai-rewrite">
        <select value={tone} onChange={(e) => setTone(e.target.value)}>
          {TONES.map((x) => <option key={x} value={x}>{t.aiTones[x]}</option>)}
        </select>
        <button disabled={busy || !ready || !scope.text.trim()} onClick={() => go('rewrite')}>{t.aiRewrite}</button>
      </div>
      <Output
        ai={ai}
        t={t}
        actions={(
          <>
            <button className="new" onClick={() => onApply(ai.action, ai.text)}>
              {ai.action === 'summarize' ? t.aiInsert : t.aiApply}
            </button>
            <button onClick={copy}>{t.aiCopy}</button>
          </>
        )}
      />
    </div>
  );
}

// Home-screen compare: pick two or more notes.
export function ComparePanel({ ai, notes, status, onSaveResult, onSettings, t }) {
  const [picked, setPicked] = useState([]);
  const toggle = (p) => setPicked((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p].slice(-6)));
  const busy = ai.phase === 'running';
  const ready = status && status.models[status.provider];
  return (
    <section className="compare">
      <h4>{t.aiCompareTitle}</h4>
      <p className="hint">{t.aiCompareHint}</p>
      <ProviderLine status={status} onSettings={onSettings} t={t} />
      <div className="compare-list">
        {notes.slice(0, 40).map((n) => (
          <label key={n.path} className={picked.includes(n.path) ? 'on' : ''}>
            <input type="checkbox" checked={picked.includes(n.path)} onChange={() => toggle(n.path)} />
            <span>{n.title || t.untitled}</span>
          </label>
        ))}
      </div>
      <button className="new" disabled={busy || !ready || picked.length < 2} onClick={() => ai.run('compare', { notes: picked })}>
        {t.aiCompare} ({picked.length})
      </button>
      <Output
        ai={ai}
        t={t}
        actions={(
          <>
            <button className="new" onClick={() => onSaveResult(ai.text)}>{t.aiSaveAsNote}</button>
            <button onClick={() => navigator.clipboard.writeText(ai.text)}>{t.aiCopy}</button>
          </>
        )}
      />
    </section>
  );
}

// Settings block: provider, model, key.
export function AiSettings({ status, setStatus, t }) {
  const [models, setModels] = useState([]);
  const [keyInput, setKeyInput] = useState('');
  const [msg, setMsg] = useState('');
  const provider = status.provider;
  const info = status.providers.find((p) => p.id === provider);

  const configure = async (patch) => {
    const res = await window.pyramid.aiConfigure(patch);
    if (res.ok) setStatus(res.value);
    else setMsg(errorText(t, res.error));
  };

  const fetchModels = useCallback(async () => {
    setMsg('');
    const res = await window.pyramid.aiModels(provider);
    if (res.ok) setModels(res.value);
    else { setModels([]); setMsg(errorText(t, res.error)); }
  }, [provider, t]);

  useEffect(() => {
    setModels([]);
    setMsg('');
    setKeyInput('');
    if (!info.needsKey || info.hasKey) fetchModels();
  }, [provider, info.needsKey, info.hasKey, fetchModels]);

  const saveKey = async (value) => {
    const res = await window.pyramid.aiSetKey(provider, value);
    if (res.ok) { setStatus(res.value); setKeyInput(''); }
    else setMsg(errorText(t, res.error));
  };

  return (
    <>
      <div className="row col">
        <div><h3>{t.ai}</h3><p>{t.aiSettingsHint}</p></div>
        <div className="seg wrap">
          {status.providers.map((p) => (
            <button key={p.id} className={provider === p.id ? 'on' : ''} onClick={() => configure({ provider: p.id })}>
              {PROVIDER_NAMES[p.id]}
            </button>
          ))}
        </div>
        <p className="hint">{info.local ? t.aiLocalHint : t.aiCloudHint}</p>
        {info.needsKey && (
          <div className="keyrow">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={info.hasKey ? t.aiKeySaved : t.aiKeyPlaceholder}
              autoComplete="off"
            />
            <button disabled={!keyInput.trim()} onClick={() => saveKey(keyInput)}>{t.aiKeySave}</button>
            {info.hasKey && <button onClick={() => saveKey('')}>{t.aiKeyRemove}</button>}
          </div>
        )}
        <div className="keyrow">
          <input
            list="ai-models"
            value={status.models[provider] || ''}
            onChange={(e) => setStatus({ ...status, models: { ...status.models, [provider]: e.target.value } })}
            onBlur={(e) => configure({ models: { [provider]: e.target.value.trim() } })}
            placeholder={t.aiModelPlaceholder}
          />
          <datalist id="ai-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
          <button onClick={fetchModels}>{t.aiRefresh}</button>
        </div>
        {provider === 'ollama' && (
          <div className="keyrow">
            <input
              defaultValue={status.ollamaHost}
              onBlur={(e) => e.target.value !== status.ollamaHost && configure({ ollamaHost: e.target.value })}
              placeholder="http://127.0.0.1:11434"
            />
          </div>
        )}
        {msg && <p className="err">{msg}</p>}
      </div>
    </>
  );
}
