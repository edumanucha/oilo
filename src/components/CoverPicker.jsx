import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import Cover from './Cover.jsx';
import { searchCovers, fetchCoverBlob } from '../lib/covers.js';

// Hoja para elegir la tapa: internet, galería, foto o link.
export default function CoverPicker({ t, book, onPick, onClose }) {
  const [mode, setMode] = useState('menu'); // 'menu' | 'web'
  const [q, setQ] = useState([book.title, book.author].filter(Boolean).join(' '));
  const [results, setResults] = useState(null);
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const galleryRef = useRef();
  const cameraRef = useRef();

  const run = async (query) => {
    setResults(null);
    setSel(null);
    try {
      setResults(await searchCovers(query));
    } catch {
      setResults([]);
    }
  };
  useEffect(() => {
    if (mode === 'web' && results === null) run(q);
  }, [mode]);

  const confirmWeb = async () => {
    if (!sel) return;
    setBusy(true);
    const blob = await fetchCoverBlob(sel.url);
    setBusy(false);
    onPick(blob ? { cover: blob, coverUrl: null } : { cover: null, coverUrl: sel.url });
  };

  const fromLink = async () => {
    const url = window.prompt(t('coverLinkPrompt'));
    if (!url) return;
    setError('');
    setBusy(true);
    const blob = await fetchCoverBlob(url.trim());
    setBusy(false);
    if (blob) onPick({ cover: blob, coverUrl: null });
    else if (/^https?:\/\//i.test(url.trim())) {
      // Algunas webs no dejan descargar la imagen: la mostramos desde el link.
      const ok = await new Promise((r) => { const img = new Image(); img.onload = () => r(true); img.onerror = () => r(false); img.src = url.trim(); });
      ok ? onPick({ cover: null, coverUrl: url.trim() }) : setError(t('coverLinkError'));
    } else setError(t('coverLinkError'));
  };

  const onFile = (e) => {
    const f = e.target.files[0];
    if (f) onPick({ cover: f, coverUrl: null });
  };

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {mode === 'menu' ? (
          <>
            <h3>{t('coverTitle')}</h3>
            <div style={{ width: '38%', alignSelf: 'center', position: 'relative' }}>
              <div className="tape" />
              <Cover book={book} />
            </div>
            <span className="note" style={{ alignSelf: 'center' }}>{t('coverChange')}</span>
            <div>
              <button className="opt" onClick={() => setMode('web')}><Icon name="search" /><div className="t"><b>{t('coverWeb')}</b><span>{t('coverWebSub')}</span></div></button>
              <button className="opt" onClick={() => galleryRef.current.click()}><Icon name="image" /><div className="t"><b>{t('coverGallery')}</b><span>{t('coverGallerySub')}</span></div></button>
              <button className="opt" onClick={() => cameraRef.current.click()}><Icon name="camera" /><div className="t"><b>{t('coverPhoto')}</b><span>{t('coverPhotoSub')}</span></div></button>
              <button className="opt" onClick={fromLink}><Icon name="link" /><div className="t"><b>{t('coverLink')}</b><span>{t('coverLinkSub')}</span></div>{busy && <span className="spin" />}</button>
              {(book.cover || book.coverUrl) && (
                <button className="opt" onClick={() => onPick({ cover: null, coverUrl: null })}><Icon name="x" /><div className="t"><b>{t('coverRemove')}</b></div></button>
              )}
            </div>
            {error && <p className="error">{error}</p>}
            <input ref={galleryRef} type="file" accept="image/*" hidden onChange={onFile} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
          </>
        ) : (
          <>
            <div className="topbar">
              <button className="icon-btn" onClick={() => setMode('menu')} aria-label={t('back')}><Icon name="back" /></button>
              <h2>{t('chooseCover')}</h2>
            </div>
            <form className="row" onSubmit={(e) => { e.preventDefault(); run(q); }}>
              <label className="field" style={{ flex: 1 }}>
                <input value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" aria-label={t('search')} />
              </label>
              <button className="icon-btn" type="submit" aria-label={t('search')}><Icon name="search" /></button>
            </form>
            {results === null ? (
              <p className="muted row"><span className="spin" /> {t('searching')}</p>
            ) : results.length === 0 ? (
              <p className="muted">{t('noResults')}</p>
            ) : (
              <>
                <span className="muted">{t('foundEditions')}</span>
                <div className="cover-grid">
                  {results.map((r) => (
                    <button key={r.url} className={`cover-opt ${sel?.url === r.url ? 'on' : ''}`} onClick={() => setSel(r)}>
                      {sel?.url === r.url && <span className="note">{t('thisOne')}</span>}
                      <div className="cover"><img src={r.url} alt="" loading="lazy" onError={(e) => { const b = e.currentTarget.closest('button'); if (b) b.style.display = 'none'; }} /></div>
                      <small>{r.label}</small>
                    </button>
                  ))}
                </div>
              </>
            )}
            <span className="postit">{t('coverSaved')}</span>
            <button className="btn primary block" disabled={!sel || busy} onClick={confirmWeb}>{busy ? <span className="spin" /> : <Icon name="check" />} {t('useCover')}</button>
          </>
        )}
      </div>
    </div>
  );
}
