import { useRef, useState } from 'react';
import Icon from './Icon.jsx';
import Cover from './Cover.jsx';
import CoverPicker from './CoverPicker.jsx';
import { importFile } from '../lib/importers.js';
import { saveBook, updateBook, deleteBook } from '../lib/db.js';

// Bibliotecas digitales gratuitas y legales (obras de dominio público o con permiso).
const FREE_LIBRARIES = [
  { name: 'Elejandría', url: 'https://www.elejandria.com/', es: 'Clásicos en español, gratis y legales', en: 'Spanish classics, free and legal' },
  { name: 'Biblioteca Virtual Miguel de Cervantes', url: 'https://www.cervantesvirtual.com/', es: 'Literatura en castellano', en: 'Spanish-language literature' },
  { name: 'Proyecto Gutenberg', url: 'https://www.gutenberg.org/browse/languages/es', es: 'Más de 70.000 libros (muchos en español)', en: '70,000+ books, many in Spanish' },
  { name: 'Wikisource', url: 'https://es.wikisource.org/', es: 'Textos libres en español', en: 'Free texts in Spanish' },
  { name: 'Standard Ebooks', url: 'https://standardebooks.org/', es: 'Clásicos en inglés, muy bien editados', en: 'Beautifully edited English classics' },
];

// Sirve para agregar un libro nuevo y para editar uno existente (existing != null).
export default function AddBook({ t, uiLang, existing, onDone, onCancel, onDeleted }) {
  const fileRef = useRef();
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(existing ? { ...existing } : null);
  const [paras, setParas] = useState(null);
  const [picking, setPicking] = useState(false);

  const onFile = async (file) => {
    if (!file) return;
    setError('');
    setProgress(0);
    try {
      const res = await importFile(file, (p) => setProgress(p));
      setParas(res.paras);
      setDraft({
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
        title: res.title,
        author: res.author,
        lang: res.lang,
        cover: res.cover,
        coverUrl: null,
        format: res.format,
        chapters: res.chapters,
        totalChars: res.paras.reduce((n, p) => n + p.length, 0),
        addedAt: Date.now(),
      });
    } catch (e) {
      console.error(e);
      setError(e.message === 'unsupported' ? t('unsupported') : e.message === 'empty' ? t('emptyFile') : t('importError'));
    }
    setProgress(null);
  };

  const save = async () => {
    if (existing) {
      const { progress: _p, ...patch } = draft;
      await updateBook(existing.id, patch);
    } else await saveBook(draft, paras);
    onDone(draft.id);
  };

  const remove = async () => {
    if (!window.confirm(t('confirmDelete', { title: existing.title }))) return;
    await deleteBook(existing.id);
    onDeleted(existing.id);
  };

  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });

  return (
    <div className="screen">
      <div className="topbar">
        <button className="icon-btn" onClick={onCancel} aria-label={t('back')}><Icon name="back" /></button>
        <h2>{existing ? t('editBook') : t('addTitle')}</h2>
      </div>

      {!draft && (
        <>
          <button className="drop" onClick={() => fileRef.current.click()} disabled={progress !== null}>
            <Icon name="upload" />
            <b>{t('pickFile')}</b>
            <span className="muted">{t('formatsLong')}</span>
          </button>
          <input ref={fileRef} type="file" hidden accept=".epub,.pdf,.docx,.txt,.md,application/epub+zip,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(e) => onFile(e.target.files[0])} />
          {progress !== null && (
            <div>
              <div className="row muted"><span className="spin" /> {t('processing')} <span className="spacer" /> {Math.round(progress * 100)}%</div>
              <div className="progress-line" style={{ marginTop: 8 }}><i style={{ width: `${progress * 100}%` }} /></div>
            </div>
          )}
          {error && <p className="error">{error}</p>}

          <div className="h4">{t('freeBooks')}</div>
          <p className="muted" style={{ margin: 0 }}>{t('freeBooksSub')}</p>
          <div>
            {FREE_LIBRARIES.map((l) => (
              <a key={l.url} className="opt" href={l.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                <Icon name="book" />
                <div className="t"><b>{l.name}</b><span>{uiLang === 'en' ? l.en : l.es}</span></div>
                <Icon name="link" />
              </a>
            ))}
          </div>
        </>
      )}

      {draft && (
        <>
          <div className="row" style={{ alignItems: 'flex-end', gap: 16 }}>
            <button style={{ width: 110, position: 'relative' }} onClick={() => setPicking(true)} aria-label={t('changeCover')}>
              <div className="tape" />
              <Cover book={draft} />
            </button>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {!existing && <span className="postit">{t('found', { n: draft.chapters.length })}</span>}
              <button className="btn" onClick={() => setPicking(true)}><Icon name="image" /> {draft.cover || draft.coverUrl ? t('changeCover') : t('searchCover')}</button>
            </div>
          </div>
          <label className="field"><span className="lbl">{t('title')}</span><input value={draft.title} onChange={set('title')} /></label>
          <label className="field"><span className="lbl">{t('author')}</span><input value={draft.author} onChange={set('author')} /></label>
          <div className="field">
            <span className="lbl">{t('writtenIn')}</span>
            <div className="tog">
              <button className={draft.lang === 'es' ? 'on' : ''} onClick={() => setDraft({ ...draft, lang: 'es' })}>{t('spanish')}</button>
              <button className={draft.lang === 'en' ? 'on' : ''} onClick={() => setDraft({ ...draft, lang: 'en' })}>{t('english')}</button>
            </div>
          </div>
          <div className="spacer" />
          <button className="btn primary block" onClick={save} disabled={!draft.title.trim()}><Icon name="check" /> {t('saveShelf')}</button>
          {existing && <button className="btn danger block" onClick={remove}><Icon name="trash" /> {t('deleteBook')}</button>}
        </>
      )}

      {picking && (
        <CoverPicker t={t} book={draft} onClose={() => setPicking(false)} onPick={(c) => { setDraft({ ...draft, ...c }); setPicking(false); }} />
      )}
    </div>
  );
}
