import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { mapCursor } from './textmap.js';
import { useLive } from './useLive.js';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { STRINGS } from './i18n.js';
import { AiPanel, AiSettings, ComparePanel, useAi, useAiStatus } from './Ai.jsx';
import { ConflictBar, ExternalBar, SyncBadge, SyncSettings, useSync } from './Sync.jsx';

const SAVE_DELAY = 700;

function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: true }));
}

function Preview({ body }) {
  const html = useMemo(() => renderMarkdown(body), [body]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

function NoteRow({ note, active, flag, onOpen, t }) {
  return (
    <button className={`note-row${active ? ' on' : ''}${flag ? ' flagged' : ''}`} onClick={() => onOpen(note.path)}>
      <strong>{note.title || t.untitled}</strong>
      <span>{note.preview}</span>
      {flag && <i className="flag" title={t.conflictMark}>!</i>}
    </button>
  );
}

function Sidebar({ notes, selected, query, setQuery, onOpen, onCreate, onSettings, sync, flagged, lang, t }) {
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = q
      ? notes.filter((n) => `${n.title} ${n.preview} ${n.tags.join(' ')}`.toLowerCase().includes(q))
      : notes;
    const map = new Map();
    for (const n of shown) {
      if (!map.has(n.notebook)) map.set(n.notebook, []);
      map.get(n.notebook).push(n);
    }
    return { shown, entries: [...map.entries()].sort(([a], [b]) => a.localeCompare(b)) };
  }, [notes, query]);

  return (
    <aside>
      <div className="brand">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <polygon points="11.7,3.5 5.2,19 11.7,19" fill="#fff" />
          <polygon points="12.3,3.5 12.3,19 18.8,19" fill="#8c8c8c" />
        </svg>
        <span>{t.appName}</span>
      </div>
      <button className="new" onClick={() => onCreate('')}>+ {t.newNote}</button>
      <input className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.search} />
      <div className="list">
        {groups.shown.length === 0 && <p className="hint">{notes.length ? t.noMatch : t.noNotes}</p>}
        {groups.entries.map(([notebook, items]) => (
          <section key={notebook}>
            {notebook && <h4>{notebook}</h4>}
            {items.map((n) => <NoteRow key={n.path} note={n} active={n.path === selected} flag={flagged.has(n.id)} onOpen={onOpen} t={t} />)}
          </section>
        ))}
      </div>
      <SyncBadge sync={sync} lang={lang} onClick={onSettings} t={t} />
      <div className="foot">
        <span>{notes.length} {t.notes}</span>
        <button onClick={onSettings}>{t.settings}</button>
      </div>
    </aside>
  );
}

function Editor({ path, title, body, setBody, status, onRemove, ai, aiStatus, onAiSettings, bars, t }) {
  const [mode, setMode] = useState('split');
  const [armed, setArmed] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const [bar, setBar] = useState(null);
  const area = useRef(null);
  const panes = useRef(null);
  const runScope = useRef(null);
  useEffect(() => setArmed(false), [path]);

  // Text that arrives from another device (live sync) must not throw the cursor to the end of the box.
  const typed = useRef(body);
  const shown = useRef(body);
  // The selection as it is on screen right now, read while rendering, i.e. before React replaces the text.
  const before = useRef({ start: 0, end: 0 });
  if (area.current) before.current = { start: area.current.selectionStart, end: area.current.selectionEnd };
  useLayoutEffect(() => {
    const el = area.current;
    const prev = shown.current;
    if (el && body !== prev && body !== typed.current) {
      el.setSelectionRange(mapCursor(prev, body, before.current.start), mapCursor(prev, body, before.current.end));
    }
    shown.current = body;
  }, [body]);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  const scope = sel.end > sel.start
    ? { text: body.slice(sel.start, sel.end), start: sel.start, end: sel.end, whole: false }
    : { text: body, start: 0, end: body.length, whole: true };

  const run = (action, input) => {
    runScope.current = scope;
    return ai.run(action, input);
  };

  const fromBar = (action) => {
    setBar(null);
    setAiOpen(true);
    run(action, { text: scope.text, title, tone: 'clearer', length: 'medium' });
  };

  const apply = (action, text) => {
    const s = runScope.current;
    if (!s) return;
    const quoted = text.split('\n').map((l) => `> ${l}`).join('\n');
    const next = action === 'summarize'
      ? `${body.slice(0, s.end)}\n\n${quoted}\n${body.slice(s.end)}`
      : body.slice(0, s.start) + text + body.slice(s.end);
    setBody(next);
    setSel({ start: 0, end: 0 });
    setBar(null);
    ai.clear();
  };

  const trackSelection = (e) => {
    const { selectionStart: start, selectionEnd: end } = e.target;
    setSel({ start, end });
    if (end <= start) setBar(null);
  };

  const showBar = (e) => {
    const { selectionStart: start, selectionEnd: end } = e.target;
    if (end <= start || !panes.current) return setBar(null);
    const box = panes.current.getBoundingClientRect();
    setBar({ x: Math.min(Math.max(e.clientX - box.left, 8), box.width - 250), y: Math.max(e.clientY - box.top - 44, 4) });
  };

  const aiForPanel = { ...ai, run };

  return (
    <div className="editor">
      <div className="toolbar">
        <div className="seg">
          {['edit', 'split', 'preview'].map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{t[m]}</button>
          ))}
        </div>
        <span className="status">{status === 'saving' ? t.saving : t.saved}</span>
        <button className={aiOpen ? 'on-ai' : ''} onClick={() => setAiOpen(!aiOpen)}>{t.ai}</button>
        <button className={`danger${armed ? ' armed' : ''}`} onClick={() => (armed ? onRemove() : setArmed(true))}>
          {armed ? t.confirmDelete : t.delete}
        </button>
      </div>
      {bars}
      <div className="work">
        <div className={`panes ${mode}`} ref={panes}>
          {mode !== 'preview' && (
            <textarea
              ref={area}
              autoFocus
              spellCheck={false}
              value={body}
              onChange={(e) => { typed.current = e.target.value; setBody(e.target.value); setBar(null); }}
              onSelect={trackSelection}
              onMouseUp={showBar}
              onScroll={() => setBar(null)}
              placeholder="# ..."
            />
          )}
          {mode !== 'edit' && <div className="pane-preview"><Preview body={body} /></div>}
          {bar && (
            <div className="sel-bar" style={{ left: bar.x, top: bar.y }} onMouseDown={(e) => e.preventDefault()}>
              <button onClick={() => fromBar('summarize')}>{t.aiSummarize}</button>
              <button onClick={() => fromBar('rewrite')}>{t.aiRewrite}</button>
              <button onClick={() => fromBar('fix')}>{t.aiFix}</button>
            </div>
          )}
        </div>
        {aiOpen && (
          <AiPanel
            ai={aiForPanel}
            status={aiStatus}
            scope={scope}
            title={title}
            onApply={apply}
            onSettings={onAiSettings}
            onClose={() => setAiOpen(false)}
            t={t}
          />
        )}
      </div>
    </div>
  );
}

function Home({ notes, onOpen, onCreate, ai, aiStatus, onSaveResult, onAiSettings, t }) {
  return (
    <div className="home">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <polygon points="11.7,3.5 5.2,19 11.7,19" fill="#fff" />
        <polygon points="12.3,3.5 12.3,19 18.8,19" fill="#8c8c8c" />
      </svg>
      <h1>{t.welcomeTitle}</h1>
      <p>{t.welcomeText}</p>
      <button className="new wide" onClick={() => onCreate('')}>+ {t.newNote}</button>
      {notes.length > 1 && (
        <ComparePanel ai={ai} notes={notes} status={aiStatus} onSaveResult={onSaveResult} onSettings={onAiSettings} t={t} />
      )}
      {notes.length > 0 && (
        <div className="recent">
          <h4>{t.recent}</h4>
          {notes.slice(0, 5).map((n) => <NoteRow key={n.path} note={n} onOpen={onOpen} t={t} />)}
        </div>
      )}
    </div>
  );
}

function SettingsModal({ settings, onChange, aiStatus, setAiStatus, sync, reloadSync, onClose, t }) {
  const pick = async () => {
    const res = await window.pyramid.pickFolder();
    if (res.ok && res.value) onChange({ notesDir: res.value });
  };
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.settings}</h2>
        <div className="row">
          <div><h3>{t.language}</h3></div>
          <div className="seg">
            {[['tr', 'Türkçe'], ['en', 'English']].map(([v, label]) => (
              <button key={v} className={settings.lang === v ? 'on' : ''} onClick={() => onChange({ lang: v })}>{label}</button>
            ))}
          </div>
        </div>
        <div className="row col">
          <div><h3>{t.notesFolder}</h3><p>{t.notesFolderHint}</p></div>
          <div className="folder">
            <code>{settings.notesDir}</code>
            <button onClick={pick}>{t.choose}</button>
          </div>
        </div>
        <SyncSettings sync={sync} reload={reloadSync} lang={settings.lang} t={t} />
        <div className="row col">
          <div className="row-head">
            <div><h3>{t.liveTitle}</h3><p>{t.liveHint}</p></div>
            <div className="seg">
              <button className={!settings.liveTyping ? 'on' : ''} onClick={() => onChange({ liveTyping: false })}>{t.syncOff}</button>
              <button className={settings.liveTyping ? 'on' : ''} onClick={() => onChange({ liveTyping: true })}>{t.syncOn}</button>
            </div>
          </div>
        </div>
        {aiStatus && <AiSettings status={aiStatus} setStatus={setAiStatus} t={t} />}
        <div className="modal-foot"><button className="new" onClick={onClose}>{t.close}</button></div>
      </div>
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState(null);
  const [notes, setNotes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [body, setBody] = useState('');
  const [status, setStatus] = useState('saved');
  const [query, setQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [external, setExternal] = useState(null);
  const loaded = useRef({ path: null, body: '' });
  const pending = useRef(null);
  // What is on disk as far as this window knows (last loaded or last saved). A different file content means
  // the note was changed elsewhere, e.g. synced from the phone.
  const savedBody = useRef('');
  const t = STRINGS[settings?.lang || 'en'];
  const ai = useAi(t);
  const [aiStatus, setAiStatus, reloadAiStatus] = useAiStatus();
  const [sync, reloadSync] = useSync();
  const liveEnabled = useRef(false);
  liveEnabled.current = !!settings?.liveTyping;
  const live = useLive({
    loaded,
    savedBody,
    setBody,
    setStatus,
    // The live link broke: carry on as a normal note, saving what is in the editor.
    onFail: () => { setStatus('saving'); clearTimeout(pending.current); pending.current = setTimeout(() => flush(), 0); },
    onForeign: (text) => setExternal(text),
  });

  const refresh = useCallback(async () => {
    const res = await window.pyramid.listNotes();
    if (res.ok) setNotes(res.value);
  }, []);

  const flush = useCallback(async () => {
    if (live.active()) {
      await live.save();
      setStatus('saved');
      refresh();
      return;
    }
    clearTimeout(pending.current);
    const { path, body: text } = loaded.current;
    if (path == null || pending.current === null) return;
    pending.current = null;
    savedBody.current = text; // set before the write: the file watcher fires while it is still in flight
    await window.pyramid.saveNote(path, text);
    setStatus('saved');
    refresh();
  }, [refresh, live]);

  const clearSelection = useCallback(() => {
    live.drop();
    clearTimeout(pending.current);
    pending.current = null;
    loaded.current = { path: null, body: '' };
    savedBody.current = '';
    setSelected(null);
    setBody('');
    setExternal(null);
  }, [live]);

  const open = useCallback(async (rel) => {
    await flush();
    await live.stop();
    ai.clear();
    const res = await window.pyramid.readNote(rel);
    if (!res.ok) return;
    let text = res.value.body;
    // Letter-by-letter live typing (a setting): the main process owns the text of this note from now on.
    const id = res.value.meta?.id;
    if (liveEnabled.current && id) {
      const liveText = await live.open(id);
      if (liveText != null) text = liveText;
    }
    loaded.current = { path: rel, body: text };
    savedBody.current = text;
    setSelected(rel);
    setBody(text);
    setExternal(null);
    setStatus('saved');
  }, [flush, live]);

  // The notes folder changed. If the open note differs from what we last loaded/saved it was edited elsewhere:
  // with nothing unsaved, just show the new text; with unsaved typing, ask (never overwrite silently).
  const checkExternal = useCallback(async () => {
    const { path } = loaded.current;
    if (path == null || live.active()) return; // a live note is written by the main process; its text arrives over the live link
    const res = await window.pyramid.readNote(path);
    if (loaded.current.path !== path) return;
    if (!res.ok) {
      if (pending.current === null) clearSelection();
      return;
    }
    const disk = res.value.body;
    if (disk === savedBody.current) return;
    if (pending.current === null) {
      loaded.current = { path, body: disk };
      savedBody.current = disk;
      setBody(disk);
      setExternal(null);
    } else {
      setExternal(disk);
    }
  }, [clearSelection, live]);

  const takeExternal = () => {
    if (live.hasForeign()) {
      live.resolveForeign(true);
      setExternal(null);
      setStatus('saved');
      return;
    }
    clearTimeout(pending.current);
    pending.current = null;
    loaded.current = { path: loaded.current.path, body: external };
    savedBody.current = external;
    setBody(external);
    setExternal(null);
    setStatus('saved');
  };

  const keepMine = async () => {
    setExternal(null);
    if (live.hasForeign()) {
      live.resolveForeign(false);
      return;
    }
    await flush();
  };

  const edit = (text) => {
    setBody(text);
    loaded.current = { path: selected, body: text };
    setStatus('saving');
    if (live.active()) {
      live.run();
      return;
    }
    clearTimeout(pending.current);
    pending.current = setTimeout(flush, SAVE_DELAY);
  };

  const create = useCallback(async (notebook) => {
    await flush();
    const res = await window.pyramid.createNote(notebook);
    if (res.ok) {
      await refresh();
      await open(res.value);
    }
  }, [flush, refresh, open]);

  const remove = async () => {
    live.drop();
    clearTimeout(pending.current);
    pending.current = null;
    const res = await window.pyramid.removeNote(selected);
    if (res.ok) {
      clearSelection();
      refresh();
    }
  };

  const saveResult = async (text) => {
    await flush();
    const res = await window.pyramid.createNote('');
    if (!res.ok) return;
    await window.pyramid.saveNote(res.value, `# ${t.aiCompareTitle}

${text}`);
    await refresh();
    await open(res.value);
  };

  const changeSettings = async (patch) => {
    if (patch.notesDir) await flush();
    const res = await window.pyramid.setSettings(patch);
    if (res.ok) {
      setSettings(res.value);
      if (patch.notesDir) {
        clearSelection();
        refresh();
      }
    }
  };

  useEffect(() => {
    window.pyramid.getSettings().then(setSettings);
    refresh();
    return window.pyramid.onNotesChanged(() => { refresh(); checkExternal(); });
  }, [refresh, checkExternal]);

  useEffect(() => window.pyramid.onLiveChanged((e) => live.onEvent(e)), [live]);

  // Switching the setting while a note is open: reopen it the new way.
  const liveWas = useRef(null);
  useEffect(() => {
    if (!settings) return;
    const on = !!settings.liveTyping;
    if (liveWas.current !== null && liveWas.current !== on && loaded.current.path) open(loaded.current.path);
    liveWas.current = on;
  }, [settings?.liveTyping]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (settings) document.documentElement.lang = settings.lang;
  }, [settings]);

  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey) return;
      if (e.key === 'n') { e.preventDefault(); create(''); }
      if (e.key === 's') { e.preventDefault(); flush(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [create, flush]);

  if (!settings) return null;

  const openConflicts = sync?.conflicts || [];
  const flagged = new Set(openConflicts.flatMap((c) => [c.noteId, c.copyId]));
  const current = notes.find((n) => n.path === selected);
  const conflict = current?.id ? openConflicts.find((c) => c.noteId === current.id || c.copyId === current.id) : null;

  const resolved = async () => {
    const res = await window.pyramid.listNotes();
    if (res.ok) {
      setNotes(res.value);
      if (!res.value.some((n) => n.path === selected)) clearSelection();
      else checkExternal();
    }
    reloadSync();
  };

  const bars = (
    <>
      {conflict && (
        <ConflictBar
          key={conflict.copyId}
          conflict={conflict}
          isCopy={current.id === conflict.copyId}
          origTitle={notes.find((n) => n.id === conflict.noteId)?.title}
          copyTitle={notes.find((n) => n.id === conflict.copyId)?.title}
          onDone={resolved}
          t={t}
        />
      )}
      {external !== null && <ExternalBar onTake={takeExternal} onKeep={keepMine} t={t} />}
    </>
  );

  return (
    <div className="layout">
      <Sidebar
        notes={notes}
        selected={selected}
        query={query}
        setQuery={setQuery}
        onOpen={open}
        onCreate={create}
        onSettings={() => setShowSettings(true)}
        sync={sync}
        flagged={flagged}
        lang={settings.lang}
        t={t}
      />
      <main key={selected || 'home'}>
        {selected
          ? <Editor
              path={selected}
              title={notes.find((n) => n.path === selected)?.title || ''}
              body={body}
              setBody={edit}
              status={status}
              onRemove={remove}
              ai={ai}
              aiStatus={aiStatus}
              onAiSettings={() => setShowSettings(true)}
              bars={bars}
              t={t}
            />
          : <Home
              notes={notes}
              onOpen={open}
              onCreate={create}
              ai={ai}
              aiStatus={aiStatus}
              onSaveResult={saveResult}
              onAiSettings={() => setShowSettings(true)}
              t={t}
            />}
      </main>
      {showSettings && (
        <SettingsModal
          settings={settings}
          onChange={changeSettings}
          aiStatus={aiStatus}
          setAiStatus={setAiStatus}
          sync={sync}
          reloadSync={reloadSync}
          onClose={() => { setShowSettings(false); reloadAiStatus(); }}
          t={t}
        />
      )}
    </div>
  );
}
