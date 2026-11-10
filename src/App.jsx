import { useCallback, useEffect, useMemo, useState } from 'react';
import Library from './components/Library.jsx';
import AddBook from './components/AddBook.jsx';
import PlayerView from './components/PlayerView.jsx';
import Settings from './components/Settings.jsx';
import Splash from './components/Splash.jsx';
import { listBooks, getBook, getText, getSetting, setSetting, requestPersistence, purgeOldAudio } from './lib/db.js';
import { player } from './lib/player.js';
import { makeT, defaultUiLang } from './lib/i18n.js';
import { DEFAULT_VOICE, DEFAULT_ST_VOICE } from './lib/voices.js';
import { ensureSamples, addSample } from './lib/samples.js';

const DEFAULT_SETTINGS = { engine: 'supertonic', rate: 1, stVoice: { ...DEFAULT_ST_VOICE }, piperVoice: { ...DEFAULT_VOICE }, systemVoice: {} };

export default function App() {
  const [view, setView] = useState({ name: 'library' });
  const [books, setBooks] = useState([]);
  const [uiLang, setUiLangState] = useState(defaultUiLang());
  const [settings, setSettingsState] = useState(DEFAULT_SETTINGS);
  const [current, setCurrent] = useState(null); // { book, paras }
  const [pState, setPState] = useState(player.state());
  const [splash, setSplash] = useState(true);
  const t = useMemo(() => makeT(uiLang), [uiLang]);

  const refresh = useCallback(async () => setBooks(await listBooks()), []);

  useEffect(() => {
    (async () => {
      setUiLangState(await getSetting('uiLang', defaultUiLang()));
      const saved = await getSetting('settings', {});
      // Quien venía de la versión anterior pasa a la voz nueva (Supertonic) una sola vez.
      const s = { ...DEFAULT_SETTINGS, ...saved, ...(saved.stVoice ? {} : { engine: 'supertonic', stVoice: { ...DEFAULT_ST_VOICE } }) };
      setSettingsState(s);
      player.configure(s);
      await ensureSamples();
      await refresh();
      const lastId = await getSetting('lastBook', null);
      if (lastId) {
        const b = await getBook(lastId);
        if (b) {
          const paras = await getText(lastId);
          player.load(b, paras);
          setCurrent({ book: b, paras });
        }
      }
    })();
    requestPersistence();
    purgeOldAudio(30).catch(() => {});
    return player.subscribe((s) => {
      setPState(s);
      if (!s.playing) refresh();
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = uiLang;
  }, [uiLang]);

  const setUiLang = (l) => {
    setUiLangState(l);
    setSetting('uiLang', l);
  };
  const setSettings = (patch) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      setSetting('settings', next);
      player.configure(patch);
      return next;
    });
  };
  // Si la voz natural falla, el reproductor pasa solo a la voz del celular: lo reflejamos.
  useEffect(() => {
    if (pState.error && settings.engine !== player.engine) setSettings({ engine: player.engine });
  }, [pState.error]);

  const openBook = async (id) => {
    if (current?.book.id !== id) {
      const b = await getBook(id);
      const paras = await getText(id);
      player.load(b, paras);
      setCurrent({ book: b, paras });
      setSetting('lastBook', id);
    }
    setView({ name: 'player' });
  };

  const reloadCurrent = async (id) => {
    const b = await getBook(id);
    if (current?.book.id === id) {
      Object.assign(player.book, { ...b, progress: player.book.progress });
      player._updateMetadata();
      setCurrent({ book: player.book, paras: current.paras });
    }
  };

  const currentBookForList = current ? books.find((b) => b.id === current.book.id) || current.book : null;

  return (
    <div className="app">
      {splash && <Splash tagline={t('tagline')} onDone={() => setSplash(false)} />}
      {view.name === 'library' && (
        <Library
          t={t}
          books={books}
          uiLang={uiLang}
          setUiLang={setUiLang}
          onOpen={openBook}
          onAdd={() => setView({ name: 'add' })}
          onSettings={() => setView({ name: 'settings' })}
          onSample={async () => { const id = await addSample(uiLang); await refresh(); openBook(id); }}
          current={currentBookForList}
          playerState={pState}
          onToggle={() => player.toggle()}
        />
      )}
      {view.name === 'add' && (
        <AddBook
          t={t}
          uiLang={uiLang}
          onCancel={() => setView({ name: 'library' })}
          onDone={async (id) => {
            await refresh();
            openBook(id);
          }}
        />
      )}
      {view.name === 'edit' && current && (
        <AddBook
          t={t}
          uiLang={uiLang}
          existing={current.book}
          onCancel={() => setView({ name: 'player' })}
          onDone={async (id) => {
            await reloadCurrent(id);
            await refresh();
            setView({ name: 'player' });
          }}
          onDeleted={async () => {
            player.stop();
            setCurrent(null);
            setSetting('lastBook', null);
            await refresh();
            setView({ name: 'library' });
          }}
        />
      )}
      {view.name === 'settings' && (
        <Settings t={t} uiLang={uiLang} setUiLang={setUiLang} settings={settings} setSettings={setSettings} onBack={() => setView({ name: 'library' })} />
      )}
      {view.name === 'player' && current && (
        <PlayerView
          t={t}
          book={current.book}
          paras={current.paras}
          state={pState}
          settings={settings}
          setSettings={setSettings}
          onBack={() => {
            refresh();
            setView({ name: 'library' });
          }}
          onEdit={() => setView({ name: 'edit' })}
          onBookChanged={() => { setCurrent({ ...current }); refresh(); }}
        />
      )}
    </div>
  );
}
