import { useMemo, useRef } from 'react';
import { LiveClient } from '../electron/sync/ot.mjs';

// This window as a device of the live typing channel (see electron/sync/live.js and ot.mjs). While a note is live,
// every keystroke is sent to the app's main process, which holds the true text and also talks to the phone; the main
// process writes the file, so the normal autosave stays out of the way for that note.
//
// loaded: ref {path, body} with the text in the editor right now.   savedBody: ref with what this window believes is on disk.
export function useLive({ loaded, savedBody, setBody, setStatus, onFail, onForeign }) {
  const cur = useRef(null); // {id, client, running, again, paused, foreign}
  const cbs = useRef({});
  cbs.current = { setBody, setStatus, onFail, onForeign };

  return useMemo(() => {
    const call = async (L, extra) => {
      const res = await window.pyramid.liveCall({ type: 'live', id: L.id, cid: L.client.cid, ...extra });
      if (!res.ok) throw new Error(res.error);
      return res.value;
    };

    const show = (text) => {
      loaded.current = { path: loaded.current.path, body: text };
      savedBody.current = text;
      cbs.current.setBody(text);
    };

    // The desktop closed the note (the phone list synced, or we were idle): ask for a fresh copy.
    const reopen = async (L) => {
      const r = await call(L, { rev: -1 });
      if (!r.ok) throw new Error(r.error);
      const before = L.client.base;
      const local = loaded.current.body;
      if (r.text === before || local === before) {
        // Nothing of ours is unsent, or nothing changed behind our back: carry on from the fresh copy.
        L.client.open(r.text, r.rev, r.ep);
        if (r.text !== local && local === before) show(r.text);
        return;
      }
      L.paused = true; // changed elsewhere while we also typed: let the user choose, never decide silently
      L.foreign = r;
      cbs.current.onForeign(r.text);
    };

    const run = () => {
      const L = cur.current;
      if (!L || L.paused) return Promise.resolve();
      if (L.running) {
        L.again = true;
        return L.running;
      }
      L.running = (async () => {
        try {
          do {
            L.again = false;
            const req = L.client.prepare(loaded.current.body);
            const r = await call(L, { ...req, wait: 0 });
            if (cur.current !== L) return;
            if (!r.ok) {
              if (r.error !== 'REOPEN') throw new Error(r.error);
              await reopen(L);
              if (L.paused) return;
              L.again = true;
              continue;
            }
            const local = loaded.current.body;
            const next = L.client.receive(r, local);
            if (next !== local) show(next);
            cbs.current.setStatus(next === L.client.base ? 'saved' : 'saving');
          } while (L.again);
        } catch {
          if (cur.current === L) {
            cur.current = null;
            cbs.current.onFail();
          }
        } finally {
          L.running = null;
        }
      })();
      return L.running;
    };

    const api = {
      active: () => cur.current !== null,
      hasForeign: () => cur.current?.foreign != null,
      run,

      // Start live typing for a note. Returns its text, or null when live typing is not available (then the caller saves as usual).
      async open(id) {
        const L = { id, client: new LiveClient(crypto.randomUUID()), running: null, again: false, paused: false, foreign: null };
        try {
          const r = await call(L, { rev: -1 });
          if (!r.ok) return null;
          L.client.open(r.text, r.rev, r.ep);
          cur.current = L;
          return r.text;
        } catch {
          return null;
        }
      },

      // Send everything and have the main process write the file now (Ctrl+S).
      async save() {
        const L = cur.current;
        if (!L) return;
        await run();
        if (cur.current === L) await window.pyramid.liveFlush(L.id);
      },

      // Leaving the note: send, write, and stop.
      async stop() {
        const L = cur.current;
        if (!L) return;
        if (!L.paused) await run();
        await window.pyramid.liveFlush(L.id);
        if (cur.current === L) cur.current = null;
      },

      drop() {
        cur.current = null;
      },

      // Someone else's change arrived at the desktop.
      onEvent(e) {
        const L = cur.current;
        if (L && L.id === e.id && e.from !== L.client.cid) run();
      },

      // The user's answer to "changed elsewhere": take the other text, or keep ours and send it over.
      resolveForeign(take) {
        const L = cur.current;
        if (!L || !L.foreign) return;
        const r = L.foreign;
        L.foreign = null;
        L.paused = false;
        L.client.open(r.text, r.rev, r.ep);
        if (take) show(r.text);
        else run();
      },
    };
    return api;
  }, [loaded, savedBody]);
}
