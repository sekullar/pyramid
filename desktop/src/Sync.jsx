import React, { useCallback, useEffect, useRef, useState } from 'react';

// Phone sync UI: settings block (pairing, devices), sidebar status, conflict bar, "changed elsewhere" bar.

export function useSync() {
  const [status, setStatus] = useState(null);
  const reload = useCallback(async () => {
    const res = await window.pyramid.syncStatus();
    if (res.ok) setStatus(res.value);
  }, []);
  useEffect(() => {
    reload();
    return window.pyramid.onSyncChanged(reload);
  }, [reload]);
  return [status, reload];
}

const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_m, k) => vars[k] ?? '');

export function ago(iso, lang, t) {
  const secs = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(secs) || secs < 45) return t.justNow;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (secs < 3600) return rtf.format(-Math.round(secs / 60), 'minute');
  if (secs < 86400) return rtf.format(-Math.round(secs / 3600), 'hour');
  return rtf.format(-Math.round(secs / 86400), 'day');
}

const latestSync = (devices) => devices.map((d) => d.lastSync).filter(Boolean).sort().pop() || null;

// Small status line above the sidebar footer. Click opens settings.
export function SyncBadge({ sync, lang, onClick, t }) {
  if (!sync) return null;
  const open = sync.conflicts.length;
  let tone = 'off';
  let text = t.syncBadgeOff;
  if (open) {
    tone = 'warn';
    text = `${open} ${t.syncBadgeConflict}`;
  } else if (sync.enabled && sync.running) {
    const last = latestSync(sync.devices);
    if (sync.devices.length === 0) { tone = 'wait'; text = t.syncBadgeWait; }
    else if (last) { tone = 'on'; text = `${t.syncBadgeDone} · ${ago(last, lang, t)}`; }
    else { tone = 'wait'; text = t.syncNever; }
  }
  return (
    <button className="sync-badge" onClick={onClick} title={t.syncTitle}>
      <i className={`dot ${tone}`} />
      <span>{text}</span>
    </button>
  );
}

function Pairing({ pairing, paired, onCancel, t }) {
  return (
    <div className="pair">
      <h4>{t.syncPairTitle}</h4>
      {paired ? (
        <div className="pair-done">
          <span className="check" aria-hidden="true">✓</span>
          <p>{t.syncPairedText}</p>
        </div>
      ) : pairing.via ? (
        <>
          <p className="hint">{t.phoneixSent}</p>
          <p className="ai-running"><span className="dots"><i /><i /><i /></span>{t.syncWaiting}</p>
          <button className="ghost" onClick={onCancel}>{t.syncCancel}</button>
        </>
      ) : (
        <>
          <div className="qr"><img src={pairing.qr} alt="QR" width="224" height="224" /></div>
          <p className="hint">{t.syncPairSteps}</p>
          <p className="ai-running"><span className="dots"><i /><i /><i /></span>{t.syncWaiting}</p>
          <button className="ghost" onClick={onCancel}>{t.syncCancel}</button>
        </>
      )}
    </div>
  );
}

export function SyncSettings({ sync, reload, lang, t }) {
  const [pairing, setPairing] = useState(null);
  const [paired, setPaired] = useState(false);
  const [armed, setArmed] = useState(null);
  const [error, setError] = useState('');
  const live = useRef({ pairing: null, paired: false });
  live.current = { pairing, paired };

  // The phone answering turns the pending device into a normal one.
  useEffect(() => {
    if (pairing && !paired && sync?.devices.some((d) => d.id === pairing.deviceId)) {
      setPaired(true);
      const timer = setTimeout(() => { setPairing(null); setPaired(false); }, 2600);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [sync, pairing, paired]);

  // Closing settings with an unfinished QR on screen drops that half-made pairing.
  useEffect(() => () => {
    if (live.current.pairing && !live.current.paired) window.pyramid.syncCancelPairing();
  }, []);

  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  if (!sync) return null;

  const toggle = async (on) => {
    setError('');
    const res = await window.pyramid.syncSetEnabled(on);
    if (!res.ok) setError(res.error);
    if (!on) { setPairing(null); setPaired(false); }
    reload();
  };

  const startPairing = async () => {
    setError('');
    setPaired(false);
    const res = await window.pyramid.syncStartPairing();
    if (res.ok) setPairing(res.value);
    else setError(res.error);
    reload();
  };

  const cancelPairing = async () => {
    await window.pyramid.syncCancelPairing();
    setPairing(null);
    reload();
  };

  const remove = async (id) => {
    if (armed !== id) return setArmed(id);
    setArmed(null);
    await window.pyramid.syncRemoveDevice(id);
    reload();
  };

  const pairViaPhoneix = async () => {
    setError('');
    setPaired(false);
    const res = await window.pyramid.syncPairViaPhoneix();
    if (res.ok) setPairing(res.value);
    else setError(t[`phoneixErr_${res.error}`] || res.error);
    reload();
  };

  const addr = sync.running && sync.hosts.length ? `${sync.hosts[0]}:${sync.port}` : null;
  const phoneix = sync.phoneix;
  const phoneixReady = phoneix.found && phoneix.running && phoneix.paired;
  const phoneixText = !phoneix.found ? t.phoneixMissing
    : !phoneix.running ? t.phoneixIdle
    : !phoneix.paired ? t.phoneixNoPhone
    : fill(t.phoneixReady, { phone: phoneix.phone ? ` (${phoneix.phone})` : '' });

  return (
    <>
      <div className="row col">
        <div className="row-head">
          <div><h3>{t.syncTitle}</h3><p>{t.syncHint}</p></div>
          <div className="seg">
            <button className={!sync.enabled ? 'on' : ''} onClick={() => toggle(false)}>{t.syncOff}</button>
            <button className={sync.enabled ? 'on' : ''} onClick={() => toggle(true)}>{t.syncOn}</button>
          </div>
        </div>

        {sync.enabled && sync.running && (
          <>
            {addr ? <p className="hint">{t.syncAt}: <code className="addr">{addr}</code></p> : <p className="warn">{t.syncNoNetwork}</p>}

            <div className="devices">
              <h4>{t.syncDevices}</h4>
              {sync.devices.length === 0 && <p className="hint">{t.syncNoDevices}</p>}
              {sync.devices.map((d) => (
                <div className="device" key={d.id}>
                  <div>
                    <strong>{d.name}</strong>
                    <span>{d.lastSync ? `${t.syncLast}: ${ago(d.lastSync, lang, t)}` : t.syncNever}</span>
                  </div>
                  <button className={`danger${armed === d.id ? ' armed' : ''}`} onClick={() => remove(d.id)}>
                    {armed === d.id ? t.confirmDelete : t.syncRemove}
                  </button>
                </div>
              ))}
            </div>

            {pairing && !pairing.via
              ? <Pairing pairing={pairing} paired={paired} onCancel={cancelPairing} t={t} />
              : <button className="new" onClick={startPairing} disabled={!addr}>+ {t.syncAddPhone}</button>}
          </>
        )}
        {error && <p className="err">{error}</p>}
      </div>

      <div className="row col">
        <div className="row-head">
          <div><h3>{t.phoneixTitle}</h3><p>{t.phoneixHint}</p></div>
          <button className="new" onClick={pairViaPhoneix} disabled={!phoneixReady || !!pairing?.via}>{t.phoneixBtn}</button>
        </div>
        <p className={phoneixReady ? 'hint' : 'warn'}>{phoneixText}</p>
        {pairing?.via && <Pairing pairing={pairing} paired={paired} onCancel={cancelPairing} t={t} />}
      </div>
    </>
  );
}

// Shown above a note that has an open conflict (either the original or the phone's copy).
export function ConflictBar({ conflict, isCopy, origTitle, copyTitle, onDone, t }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choose = async (choice) => {
    setBusy(true);
    setError('');
    const res = await window.pyramid.syncResolve(conflict.copyId, choice);
    setBusy(false);
    if (res.ok) onDone(choice);
    else setError(`${t.conflictFail}: ${res.error}`);
  };
  const message = isCopy
    ? fill(t.conflictCopy, { title: origTitle || t.untitled, device: conflict.deviceName })
    : fill(t.conflictOrig, { title: copyTitle || t.untitled });
  const options = [
    ['desktop', t.conflictDesktop, t.conflictDesktopHint],
    ['phone', t.conflictPhone, t.conflictPhoneHint],
    ['merge', t.conflictMerge, t.conflictMergeHint],
    ['both', t.conflictBoth, t.conflictBothHint],
  ];
  return (
    <div className="bar conflict" role="alert">
      <div className="bar-text">
        <span className="pill cloud">{t.conflictMark}</span>
        <p>{message} <strong>{t.conflictAsk}</strong></p>
      </div>
      <div className="bar-actions">
        {options.map(([id, label, hint]) => (
          <button key={id} disabled={busy} title={hint} onClick={() => choose(id)}>{label}</button>
        ))}
      </div>
      {error && <p className="err">{error}</p>}
    </div>
  );
}

// The open note changed on disk (synced from another device) while the user has unsaved typing.
export function ExternalBar({ onTake, onKeep, t }) {
  return (
    <div className="bar" role="alert">
      <div className="bar-text">
        <span className="pill cloud">!</span>
        <p>{t.externalChanged} <span className="faint">{t.externalNote}</span></p>
      </div>
      <div className="bar-actions">
        <button onClick={onTake}>{t.externalTake}</button>
        <button onClick={onKeep}>{t.externalKeep}</button>
      </div>
    </div>
  );
}
