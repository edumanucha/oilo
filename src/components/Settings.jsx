import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { PIPER_VOICES, SUPERTONIC_VOICES, SUPERTONIC_MB, systemVoices, waitForSystemVoices } from '../lib/voices.js';
import { player } from '../lib/player.js';
import { makeT } from '../lib/i18n.js';
import { APP_VERSION, checkForUpdate } from '../lib/updater.js';
import { testKey } from '../lib/ai.js';
import { localAi, LOCAL_AI_MB } from '../lib/localAi.js';

// IA chiquita dentro del celular: sin clave ni cuenta. Se baja una vez (~480 MB).
function LocalAiPanel({ t, settings, setSettings }) {
  const [ready, setReady] = useState(null);
  const [prog, setProg] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    localAi.isDownloaded().then((ok) => {
      setReady(ok);
      if (ok && !settings.aiLocal) setSettings({ aiLocal: true });
    }).catch(() => setReady(false));
  }, []);
  const download = async () => {
    setErr('');
    setProg(0);
    localAi.onDownload = (f) => setProg(f);
    try {
      await localAi.download();
      setReady(true);
      setSettings({ aiLocal: true });
    } catch (e) {
      console.error(e);
      setErr(t('localAiError'));
    }
    localAi.onDownload = null;
    setProg(null);
  };
  const remove = async () => {
    await localAi.remove();
    setReady(false);
    setSettings({ aiLocal: false });
  };
  return (
    <div>
      <div className="h4">{t('localAiTitle')}</div>
      <p className="muted" style={{ margin: '6px 0' }}>{t('localAiExplain')}</p>
      {ready ? (
        <div className="voice on">
          <div className="who">
            <b>{t('localAiReady')}</b>
            <span>{settings.aiLocal ? t('localAiOn') : t('localAiPaused')}</span>
          </div>
          <button className="use" onClick={() => setSettings({ aiLocal: !settings.aiLocal })}>{settings.aiLocal ? t('aiOff') : t('aiOn')}</button>
          <button className="icon-btn" onClick={remove} aria-label={t('removeVoice')}><Icon name="trash" /></button>
        </div>
      ) : prog !== null ? (
        <div style={{ margin: '10px 0' }}>
          <div className="row muted"><span className="spin" /> {prog >= 0.999 ? t('localAiPreparing') : t('localAiDownloading', { n: Math.round(prog * 100) })}</div>
          <div className="progress-line" style={{ marginTop: 6 }}><i style={{ width: `${prog * 100}%` }} /></div>
        </div>
      ) : (
        <button className="btn primary block" onClick={download} disabled={ready === null}><Icon name="download" /> {t('localAiDownload', { mb: LOCAL_AI_MB })}</button>
      )}
      {err && <p className="error">{err}</p>}
    </div>
  );
}

// Resúmenes con IA: el usuario pega su clave gratuita de Google AI Studio.
function AiKeyPanel({ t, settings, setSettings }) {
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState(null); // null | 'testing' | 'ok' | código de error
  const hasKey = !!settings.aiKey;

  const save = async () => {
    const key = draft.trim();
    if (!key) return;
    setStatus('testing');
    try {
      await testKey(key);
      setSettings({ aiKey: key });
      setDraft('');
      setStatus('ok');
    } catch (e) {
      setStatus(e.code || 'other');
    }
  };

  return (
    <div>
      <div className="h4">{t('aiTitle')}</div>
      <p className="muted" style={{ margin: '6px 0' }}>{t('aiExplain')}</p>
      {hasKey ? (
        <div className="voice on">
          <div className="who">
            <b>{t('aiActive')}</b>
            <span>{t('aiKeySaved', { end: settings.aiKey.slice(-4) })}</span>
          </div>
          <button className="use" onClick={() => { setSettings({ aiKey: '' }); setStatus(null); }}>{t('aiRemove')}</button>
        </div>
      ) : (
        <>
          <ol className="recap" style={{ fontSize: 15 }}>
            <li><span>{t('aiStep1')} <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com/apikey</a></span></li>
            <li><span>{t('aiStep2')}</span></li>
            <li><span>{t('aiStep3')}</span></li>
          </ol>
          <form className="row" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <label className="field" style={{ flex: 1 }}>
              <input type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('aiPlaceholder')} aria-label={t('aiPlaceholder')} />
            </label>
            <button className="btn primary" type="submit" disabled={!draft.trim() || status === 'testing'}>
              {status === 'testing' ? <span className="spin" /> : <Icon name="check" />} {t('aiSave')}
            </button>
          </form>
        </>
      )}
      {status === 'ok' && <p className="muted">{t('aiOk')}</p>}
      {status && !['ok', 'testing'].includes(status) && <p className="error">{t('aiErr_' + status)}</p>}
      <p className="muted tiny">{t('aiPrivacy')}</p>
    </div>
  );
}

const piperLib = () => import('@mintplex-labs/piper-tts-web');

// Lista de voces para un idioma (se usa en Ajustes y en el reproductor).
export function VoicePanel({ t, lang, settings, setSettings }) {
  const [stored, setStored] = useState([]);
  const [dl, setDl] = useState({});
  const [sysVoices, setSysVoices] = useState(systemVoices(lang));
  const [testing, setTesting] = useState(null);
  const [stReady, setStReady] = useState(null);
  const [stProg, setStProg] = useState(null);
  const [myVoices, setMyVoices] = useState([]);
  const [showOld, setShowOld] = useState(false);
  const refreshSt = () => {
    player.supertonic.isDownloaded().then(setStReady).catch(() => setStReady(false));
    player.supertonic.voices().then(setMyVoices).catch(() => {});
  };
  useEffect(refreshSt, []);
  const stDownload = async () => {
    setStProg(0);
    const prev = player.supertonic.onDownload;
    player.supertonic.onDownload = (m) => { setStProg(m.loaded); prev?.(m); };
    try {
      await player.supertonic.download();
      // De entrada quedan bajadas las dos voces por defecto (hombre y mujer).
      await Promise.all(['M5', 'F1', settings.stVoice?.[lang]].filter(Boolean).map((v) => player.supertonic.addVoice(v)));
    } catch (e) { console.error(e); alert(t('piperError')); }
    player.supertonic.onDownload = prev;
    setStProg(null);
    refreshSt();
  };
  const chooseSt = async (id) => {
    if (!myVoices.includes(id)) await player.supertonic.addVoice(id);
    setSettings({ engine: 'supertonic', stVoice: { ...settings.stVoice, [lang]: id } });
    refreshSt();
  };
  const removeSt = async (id) => {
    if (settings.stVoice?.[lang] === id) return alert(t('cantRemoveActive'));
    await player.supertonic.removeVoice(id);
    refreshSt();
  };
  const addSt = async (id) => {
    await player.supertonic.addVoice(id);
    refreshSt();
  };
  // Prueba con un mini diálogo, en el idioma de la lista.
  const testSt = async (id) => {
    setTesting(id);
    try {
      const blob = await player.supertonic.synth(id, makeT(lang)('dialogSample'), lang);
      const a = new Audio(URL.createObjectURL(blob));
      a.playbackRate = settings.rate;
      await a.play();
      refreshSt();
    } catch (e) { console.error(e); alert(t('piperError')); }
    setTesting(null);
  };

  const refresh = async () => {
    try {
      setStored(await (await piperLib()).stored());
    } catch {}
  };
  useEffect(() => {
    refresh();
    waitForSystemVoices().then(() => setSysVoices(systemVoices(lang)));
  }, [lang]);

  const download = async (id) => {
    setDl((d) => ({ ...d, [id]: 0 }));
    try {
      const lib = await piperLib();
      await lib.download(id, (p) => setDl((d) => ({ ...d, [id]: p.total ? p.loaded / p.total : 0 })));
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) {
      console.error(e);
    }
    setDl((d) => {
      const n = { ...d };
      delete n[id];
      return n;
    });
    refresh();
  };

  const choosePiper = (id) => setSettings({ engine: 'piper', piperVoice: { ...settings.piperVoice, [lang]: id } });
  const chooseSystem = (uri) => setSettings({ engine: 'system', systemVoice: { ...settings.systemVoice, [lang]: uri } });

  const testPiper = async (id) => {
    setTesting(id);
    try {
      const blob = await player.piper.synth(id, makeT(lang)('testPhrase'));
      const a = new Audio(URL.createObjectURL(blob));
      a.playbackRate = settings.rate;
      await a.play();
      refresh();
    } catch (e) {
      console.error(e);
      alert(t('piperError'));
    }
    setTesting(null);
  };
  const testSystem = (v) => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(makeT(lang)('testPhrase'));
    u.voice = v;
    u.lang = v.lang;
    u.rate = settings.rate;
    speechSynthesis.speak(u);
  };

  const voices = PIPER_VOICES.filter((v) => v.lang === lang);
  const activeSystem = settings.systemVoice[lang] || sysVoices[0]?.voiceURI;
  return (
    <div>
      <div className="h4" style={{ marginTop: 0 }}>{t('stTitle')}</div>
      {stReady === false && stProg === null && (
        <button className="btn primary block" style={{ margin: '10px 0 4px' }} onClick={stDownload}><Icon name="download" /> {t('stDownload', { mb: SUPERTONIC_MB })}</button>
      )}
      {stProg !== null && (
        <div style={{ margin: '10px 0' }}>
          <div className="row muted"><span className="spin" /> {t('downloading', { n: Math.round(stProg * 100) })}</div>
          <div className="progress-line" style={{ marginTop: 6 }}><i style={{ width: `${stProg * 100}%` }} /></div>
        </div>
      )}
      {stReady && (
        <>
          {[['mine', SUPERTONIC_VOICES.filter((v) => myVoices.includes(v.id))], ['more', SUPERTONIC_VOICES.filter((v) => !myVoices.includes(v.id))]].map(([group, list]) =>
            list.length ? (
              <div key={group}>
                <div className="h4">{group === 'mine' ? t('myVoices') : t('moreVoices')}</div>
                {list.map((v) => {
                  const on = settings.engine === 'supertonic' && settings.stVoice?.[lang] === v.id;
                  return (
                    <div key={v.id} className={`voice ${on ? 'on' : ''}`}>
                      <div className="who">
                        <b>{v.name}</b>
                        <span>{v.gender === 'f' ? t('female') : t('male')} · {v.desc[t('langCode')] || v.desc.es}</span>
                      </div>
                      <button className="use" style={{ borderStyle: 'dashed' }} onClick={() => testSt(v.id)} disabled={!!testing}>
                        {testing === v.id ? <span className="spin" style={{ width: 14, height: 14 }} /> : t('test')}
                      </button>
                      {group === 'mine' ? (
                        <>
                          <button className="use" onClick={() => chooseSt(v.id)}>{on ? t('iUseIt') : t('use')}</button>
                          {!on && <button className="icon-btn" onClick={() => removeSt(v.id)} aria-label={t('removeVoice')}><Icon name="trash" /></button>}
                        </>
                      ) : (
                        <button className="icon-btn" onClick={() => addSt(v.id)} aria-label={t('download')}><Icon name="download" /></button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null
          )}
        </>
      )}
      <button className="btn block" style={{ marginTop: 14 }} onClick={() => setShowOld(!showOld)}>{showOld ? t('hideOtherVoices') : t('showOtherVoices')}</button>
      {showOld && <>
      <div className="h4">{t('naturalFree')}</div>
      {voices.map((v) => {
        const isStored = stored.includes(v.id);
        const on = settings.engine === 'piper' && settings.piperVoice[lang] === v.id;
        const progress = dl[v.id];
        return (
          <div key={v.id} className={`voice ${on ? 'on' : ''}`}>
            <div className="who">
              <b>{v.name}</b>
              <span>
                {v.gender === 'f' ? t('female') : t('male')} · {v.accent} ·{' '}
                {progress !== undefined ? t('downloading', { n: Math.round(progress * 100) }) : isStored ? t('ready') : `${v.mb} MB`}
              </span>
            </div>
            <button className="icon-btn" onClick={() => testPiper(v.id)} aria-label={t('test')} disabled={!!testing}>
              {testing === v.id ? <span className="spin" /> : <Icon name="volume" />}
            </button>
            {!isStored && progress === undefined && (
              <button className="icon-btn" onClick={() => download(v.id)} aria-label={t('download')}><Icon name="download" /></button>
            )}
            <button className="use" onClick={() => choosePiper(v.id)}>{on ? t('iUseIt') : t('use')}</button>
          </div>
        );
      })}

      <div className="h4">{t('phoneVoices')}</div>
      {sysVoices.length === 0 && <p className="muted">{t('noSystemVoices')}</p>}
      {sysVoices.slice(0, 8).map((v) => {
        const on = settings.engine === 'system' && activeSystem === v.voiceURI;
        return (
          <div key={v.voiceURI} className={`voice ${on ? 'on' : ''}`}>
            <div className="who">
              <b>{v.name.replace(/^(Microsoft|Google)\s+/, '')}</b>
              <span>{v.lang} · {t('noDownload')}</span>
            </div>
            <button className="icon-btn" onClick={() => testSystem(v)} aria-label={t('test')}><Icon name="volume" /></button>
            <button className="use" onClick={() => chooseSystem(v.voiceURI)}>{on ? t('iUseIt') : t('use')}</button>
          </div>
        );
      })}
      </>}
      <p className="postit" style={{ marginTop: 16 }}>{t('lockTip')}</p>
    </div>
  );
}

export default function Settings({ t, uiLang, setUiLang, settings, setSettings, onBack, focus }) {
  // Si venimos del resumen, vamos directo a la parte de la clave de Gemini.
  useEffect(() => {
    if (focus !== 'ai') return;
    const id = setTimeout(() => document.getElementById('ai-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 150);
    return () => clearTimeout(id);
  }, [focus]);
  const [lang, setLang] = useState(uiLang);
  return (
    <div className="screen">
      <div className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label={t('back')}><Icon name="back" /></button>
        <h2>{t('whoReads')}</h2>
      </div>
      <div className="tog">
        <button className={lang === 'es' ? 'on' : ''} onClick={() => setLang('es')}>{t('spanish')}</button>
        <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>{t('english')}</button>
      </div>
      <VoicePanel t={t} lang={lang} settings={settings} setSettings={setSettings} />
      <div className="h4">{t('speed')} · {String(settings.rate).replace('.', ',')}×</div>
      <input className="scrub" type="range" min="0.5" max="3" step="0.05" value={settings.rate} onChange={(e) => setSettings({ rate: Number(e.target.value) })} />
      <div id="ai-panel" style={{ scrollMarginTop: 70 }}>
        <LocalAiPanel t={t} settings={settings} setSettings={setSettings} />
        <details className="ai-adv" open={settings.aiKey ? true : undefined}>
          <summary>{t('aiGeminiOptional')}</summary>
          <AiKeyPanel t={t} settings={settings} setSettings={setSettings} />
        </details>
      </div>
      <div className="h4">{t('theme')}</div>
      <div className="tog">
        {['auto', 'light', 'dark'].map((th) => (
          <button key={th} className={(settings.theme || 'auto') === th ? 'on' : ''} onClick={() => setSettings({ theme: th })}>{t(th === 'auto' ? 'themeAuto' : th === 'light' ? 'themeLight' : 'themeDark')}</button>
        ))}
      </div>
      <div className="h4">{t('appLanguage')}</div>
      <div className="tog">
        <button className={uiLang === 'es' ? 'on' : ''} onClick={() => setUiLang('es')}>Español</button>
        <button className={uiLang === 'en' ? 'on' : ''} onClick={() => setUiLang('en')}>English</button>
      </div>
      <p className="muted" style={{ textAlign: 'center', marginTop: 20 }}>{t('about')}</p>
      <UpdateRow t={t} />
    </div>
  );
}

function UpdateRow({ t }) {
  const [state, setState] = useState('idle'); // idle | checking | latest
  const check = async () => {
    setState('checking');
    const updating = await checkForUpdate();
    if (!updating) setState('latest');
  };
  return (
    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
      <span className="muted tiny">{t('version')}: {APP_VERSION}</span>
      <button className="btn" onClick={check} disabled={state === 'checking'}>
        {state === 'checking' ? <span className="spin" /> : <Icon name="download" />} {state === 'latest' ? t('upToDate') : t('checkUpdate')}
      </button>
    </div>
  );
}
