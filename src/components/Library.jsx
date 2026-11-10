import { useState } from 'react';
import Cover from './Cover.jsx';
import Icon from './Icon.jsx';
import { formatDuration } from '../lib/text.js';
import { chapterLabel } from '../lib/i18n.js';
import InstallButton from './InstallButton.jsx';

function greeting(t) {
  const h = new Date().getHours();
  return h >= 5 && h < 13 ? t('morning') : h >= 13 && h < 20 ? t('afternoon') : t('evening');
}

export default function Library({ t, books, uiLang, setUiLang, onOpen, onAdd, onSettings, onSample, onDiscover, current, playerState, onToggle }) {
  const [filter, setFilter] = useState('all');
  const status = (b) => (b.progress?.finished ? 'finished' : b.progress?.fraction > 0 ? 'reading' : 'unread');
  const shown = books.filter((b) => filter === 'all' || status(b) === filter);
  const rows = [];
  for (let i = 0; i < shown.length; i += 3) rows.push(shown.slice(i, i + 3));

  const cur = current;
  const curFrac = cur?.progress?.fraction || 0;
  const curLeft = cur ? formatDuration(((cur.totalChars || 0) * (1 - curFrac)) / 900 * 60000, t) : '';
  const curCh = cur ? (() => {
    const p = cur.progress?.p || 0;
    let idx = 0;
    cur.chapters.forEach((c, i) => { if (c.start <= p) idx = i; });
    return chapterLabel(cur.lang, idx + 1, cur.chapters[idx]?.title, cur.chapters[idx]?.pages);
  })() : '';

  return (
    <div className="screen">
      <div className="hello">
        <div>
          <span className="greet">{greeting(t)}</span>
          <h1>{t('yourBooks')}</h1>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <div className="lang">
            <button className={uiLang === 'es' ? 'on' : ''} onClick={() => setUiLang('es')}>ES</button>·
            <button className={uiLang === 'en' ? 'on' : ''} onClick={() => setUiLang('en')}>EN</button>
          </div>
          <button className="icon-btn" onClick={onSettings} aria-label={t('settings')}><Icon name="settings" /></button>
        </div>
      </div>

      <InstallButton t={t} />

      {cur && (
        <div className="cont" onClick={() => onOpen(cur.id)} role="button">
          <div className="cover-w"><Cover book={cur} /></div>
          <div className="t">
            <span className="note">{t('continueHere')}</span>
            <b>{cur.title}</b>
            <span className="muted">{curCh} · {t('left', { t: curLeft })}</span>
          </div>
          <button className="play" onClick={(e) => { e.stopPropagation(); onToggle(); }} aria-label="play">
            <Icon name={playerState.playing ? 'pause' : 'play'} />
          </button>
        </div>
      )}

      {books.length > 0 && (
        <button className="opt discover-entry" onClick={onDiscover}>
          <Icon name="sparkle" />
          <div className="t"><b>{t('discover')}</b><span>{t('discoverSub')}</span></div>
          <Icon name="back" />
        </button>
      )}

      {books.length > 0 && (
        <div className="tabs">
          {['all', 'reading', 'finished', 'unread'].map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{t(f)}</button>
          ))}
        </div>
      )}

      {books.length === 0 ? (
        <div className="empty">
          <img src="icon.svg" alt="" />
          <h3>{t('emptyTitle')}</h3>
          <p className="muted" style={{ margin: 0 }}>{t('emptyBody')}</p>
          <button className="btn primary" onClick={onAdd}><Icon name="plus" /> {t('addTitle')}</button>
          <button className="btn" onClick={onSample}><Icon name="book" /> {t('sampleBook')}</button>
          <span className="postit" style={{ marginTop: 18, maxWidth: 280 }}>{t('about')}</span>
        </div>
      ) : (
        <div style={{ paddingTop: 10, paddingBottom: 70 }}>
          {rows.map((row, r) => (
            <div key={r}>
              <div className="shelf">
                {row.map((b, i) => {
                  const st = status(b);
                  return (
                    <button key={b.id} className="book" onClick={() => onOpen(b.id)} aria-label={b.title}>
                      {st === 'reading' && <div className={`ribbon ${(r + i) % 2 ? 'green' : ''}`} />}
                      {st !== 'reading' && (r * 3 + i) % 4 === 1 && <div className="tape" />}
                      <Cover book={b} showFormat />
                    </button>
                  );
                })}
              </div>
              <div className="book-meta">
                {row.map((b) => {
                  const st = status(b);
                  const pct = st === 'finished' ? 100 : Math.round((b.progress?.fraction || 0) * 100);
                  return (
                    <div key={b.id}>
                      <b>{b.title}</b>
                      <span className="pct"><i style={{ width: `${pct}%` }} /></span>
                      {st === 'finished' ? t('done') : st === 'unread' ? t('new') : `${pct}%`}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {books.length > 0 && (
        <button className="add-btn" onClick={onAdd}><Icon name="plus" /> {t('addShort')}</button>
      )}
    </div>
  );
}
