import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { recommend } from '../lib/discover.js';
import { placeholderColors } from '../lib/covers.js';

// "Descubrir": libros parecidos a los que tenés (o a cualquier título que escribas).
export default function Discover({ t, books, initialId, onBack }) {
  const real = books.filter((b) => b.format !== 'demo');
  const seeds = real.length ? real : books;
  const [seedId, setSeedId] = useState(initialId && seeds.some((b) => b.id === initialId) ? initialId : seeds[0]?.id || null);
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState(null); // título escrito a mano
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const seedBook = seeds.find((b) => b.id === seedId);
  const target = custom || (seedBook ? { title: seedBook.title, author: seedBook.author } : null);

  useEffect(() => {
    if (!target) return;
    let alive = true;
    setData(null);
    setError('');
    recommend(target.title, target.author, { exclude: books.map((b) => b.title) })
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(t('discoverError')));
    return () => {
      alive = false;
    };
  }, [target?.title, target?.author]);

  return (
    <div className="screen">
      <div className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label={t('back')}><Icon name="back" /></button>
        <h2>{t('discover')}</h2>
      </div>

      <form className="row" onSubmit={(e) => { e.preventDefault(); if (query.trim()) setCustom({ title: query.trim(), author: '' }); }}>
        <label className="field" style={{ flex: 1 }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('discoverPlaceholder')} enterKeyHint="search" aria-label={t('discoverPlaceholder')} />
        </label>
        <button className="icon-btn" type="submit" aria-label={t('search')}><Icon name="search" /></button>
      </form>

      {seeds.length > 0 && (
        <div className="tabs">
          {seeds.map((b) => (
            <button key={b.id} className={!custom && seedId === b.id ? 'on' : ''} onClick={() => { setCustom(null); setQuery(''); setSeedId(b.id); }}>
              {b.title.length > 22 ? b.title.slice(0, 21) + '…' : b.title}
            </button>
          ))}
        </div>
      )}

      {target && <span className="note">{t('becauseYouLike', { title: data?.seed?.title || target.title })}</span>}

      {error && <p className="error">{error}</p>}
      {!data && !error && target && <p className="muted row"><span className="spin" /> {t('searching')}</p>}
      {data && !data.items.length && <p className="muted">{t('discoverEmpty')}</p>}

      {data?.items?.length > 0 && (
        <div className="disc-list">
          {data.items.map((it) => {
            const [fg, bg] = placeholderColors(it.title);
            return (
              <a key={it.key} className="disc" href={it.url} target="_blank" rel="noopener noreferrer">
                <div className="cover" style={{ width: 70 }}>
                  {it.cover ? <img src={it.cover} alt="" loading="lazy" /> : <div className="ph" style={{ background: bg, color: fg }}><b>{it.title}</b></div>}
                </div>
                <div className="t">
                  <b>{it.title}</b>
                  <span className="muted">{[it.author, it.year].filter(Boolean).join(' · ')}</span>
                  <span className="why">{t('sharedThemes')}: {it.reason.join(', ')}</span>
                  {it.free && <span className="free">{t('freeLegal')}</span>}
                </div>
                <Icon name="link" />
              </a>
            );
          })}
        </div>
      )}
      <p className="muted" style={{ textAlign: 'center' }}>{t('discoverSource')}</p>
    </div>
  );
}
