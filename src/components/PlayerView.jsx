import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import Cover from './Cover.jsx';
import { VoicePanel } from './Settings.jsx';
import CoverPicker from './CoverPicker.jsx';
import { updateBook } from '../lib/db.js';
import { player } from '../lib/player.js';
import { chapterLabel, makeT } from '../lib/i18n.js';
import { formatDuration } from '../lib/text.js';
import { PIPER_VOICES, SUPERTONIC_VOICES } from '../lib/voices.js';

const SPEEDS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const DAY = 24 * 3600 * 1000;
const fmtRate = (r) => `${String(Math.round(r * 100) / 100).replace('.', ',')}×`;

export default function PlayerView({ t, book, paras, state, settings, setSettings, onBack, onEdit, onBookChanged }) {
  const [coverOpen, setCoverOpen] = useState(false);
  const [sheet, setSheet] = useState(null); // 'chapters' | 'speed' | 'voice' | 'sleep' | 'recap'
  const [showText, setShowText] = useState(false);
  const [follow, setFollow] = useState(true);
  // Saltar a una frase del resumen ("me quedé dormido en la parte 5").
  const jumpTo = (pt) => {
    player.seek({ p: pt.p, s: pt.si, a: null });
    setSheet(null);
    setFollow(true);
    if (!state.playing) player.play();
  };
  const [recapTab, setRecapTab] = useState('last');
  const [listTab, setListTab] = useState('chapters');
  const [marked, setMarked] = useState(false);
  const mark = () => { player.addBookmark(); setMarked(true); setTimeout(() => setMarked(false), 1800); };
  const [recap, setRecap] = useState(null);
  const [recapAll, setRecapAll] = useState(null);
  const [dragFrac, setDragFrac] = useState(null);
  const awayMs = useMemo(() => (book.progress?.listenedAt ? Date.now() - book.progress.listenedAt : 0), [book.id]);
  const [welcome, setWelcome] = useState(awayMs > DAY && (book.progress?.fraction || 0) > 0.002);

  const c = state.cursor || { p: 0, s: 0 };
  const chIdx = state.chapterIndex;
  const ch = book.chapters[chIdx];
  const chName = chapterLabel(book.lang, chIdx + 1, ch?.title, ch?.pages);
  const frac = player.bookProgress();
  const chFrac = player.chapterProgress();
  const nowText = c.a ? chName : player.sentencesOf(c.p)[c.s] || '';
  const voiceName = settings.engine === 'supertonic' ? SUPERTONIC_VOICES.find((v) => v.id === settings.stVoice?.[book.lang])?.name : settings.engine === 'piper' ? PIPER_VOICES.find((v) => v.id === settings.piperVoice[book.lang])?.name : t('engineSystem');
  const bt = makeT(book.lang); // textos que dice la voz: en el idioma del libro

  const openRecap = (tab = 'last') => {
    setRecap(player.buildRecap());
    setRecapAll(player.buildRecapAll());
    setRecapTab(tab);
    setSheet('recap');
    setWelcome(false);
  };
  const recapLines = () => {
    if (recapTab === 'all') {
      const lines = [bt('recapAllIntro', { title: book.title })];
      recapAll.items.forEach((it) => {
        lines.push(chapterLabel(book.lang, it.n, it.title, it.pages) + '.');
        it.lines.forEach((l) => lines.push(l));
      });
      lines.push(bt('recapEnd'));
      return lines;
    }
    const chapterName = chapterLabel(book.lang, recap.chapterNumber, recap.chapterTitle, recap.pages);
    return [bt('recapIntro', { title: book.title, chapter: chapterName }), bt('recapLead'), ...recap.sentences, bt('recapEnd')];
  };

  const daysAway = Math.floor(awayMs / DAY);
  const status = state.download !== undefined && state.loading && state.download < 1
    ? t('downloading', { n: Math.round(state.download * 100) })
    : state.recapActive ? t('recapPlaying')
    : state.loading ? t('preparingVoice')
    : state.error === 'piper' ? t('piperError')
    : state.finished ? t('finishedBook')
    : state.usingFallback ? t('fallbackNote', { name: voiceName || '' })
    : state.preparing ? t('preparingChapter', { n: state.preparing.chapter + 1, pct: Math.round((state.preparing.frac || 0) * 100) }) : '';

  const playBtn = (
    <button className="play" onClick={() => player.toggle()} aria-label={state.playing ? 'pause' : 'play'}>
      {state.loading && state.playing ? <span className="spin" style={{ width: 26, height: 26 }} /> : <Icon name={state.playing ? 'pause' : 'play'} />}
    </button>
  );

  return (
    <div className="screen player">
      <div className="topbar sticky-top">
        <button className="icon-btn" onClick={onBack} aria-label={t('back')}><Icon name="down" /></button>
        <span className="mid">{t('chapterOf', { n: chIdx + 1, total: book.chapters.length })}<small>{t('chapterLeft', { t: formatDuration(player.chapterRemainingMs(), t) })}</small></span>
        <button className="icon-btn" onClick={onEdit} aria-label={t('editBook')}><Icon name="edit" /></button>
        <button className="icon-btn" onClick={() => setSheet('chapters')} aria-label={t('chapters')}><Icon name="list" /></button>
      </div>

      {welcome && (
        <button className="postit" style={{ textAlign: 'left' }} onClick={() => openRecap('last')}>
          {t('welcomeBack', { t: daysAway === 1 ? t('oneDay') : t('days', { n: daysAway }) })} <u>{t('recapShort')}</u>
        </button>
      )}

      {showText ? (
        <Reader book={book} paras={paras} cursor={c} t={t} playing={state.playing && !state.loading} follow={follow} setFollow={setFollow} />
      ) : (
        <>
          <button className="big" onClick={() => setCoverOpen(true)} aria-label={t('changeCover')}>
            {(book.progress?.fraction || 0) > 0 && <div className="ribbon" style={{ height: 34, width: 13 }} />}
            <Cover book={book} />
            <span className="note cover-hint">{t('coverChange')}</span>
          </button>
          <div className="titles">
            <b>{book.title}</b>
            <span>{book.author}</span>
          </div>
          <div className="now">{state.recapActive ? '…' : c.a ? nowText : <>“<Karaoke text={nowText} active={state.playing && !state.loading} />”</>}</div>
          <div>
            <input
              className="scrub"
              type="range"
              min="0"
              max="1000"
              value={Math.round((dragFrac ?? frac) * 1000)}
              onChange={(e) => setDragFrac(Number(e.target.value) / 1000)}
              onPointerUp={() => { if (dragFrac !== null) { player.goToFraction(dragFrac); setDragFrac(null); } }}
              onKeyUp={() => { if (dragFrac !== null) { player.goToFraction(dragFrac); setDragFrac(null); } }}
              aria-label="progress"
            />
            <div className="marks">
              <span>{t('chapterLeft', { t: formatDuration(player.chapterRemainingMs(), t) })}</span>
              <span>{t('bookLeft', { t: formatDuration(player.remainingMs(), t) })}</span>
              <span>{t('bookPct', { n: Math.round((dragFrac ?? frac) * 100) })}</span>
            </div>
          </div>
          <div className="controls">
            <button className="sk" onClick={() => player.prevChapter()}><Icon name="skipBack" />{t('chap')}</button>
            <button className="sk" onClick={() => player.prevSentence()}><Icon name="prev" />{t('phrase')}</button>
            {playBtn}
            <button className="sk" onClick={() => player.nextSentence()}><Icon name="next" />{t('phrase')}</button>
            <button className="sk" onClick={() => player.nextChapter()}><Icon name="skipFwd" />{t('chap')}</button>
          </div>
        </>
      )}

      <div className="status">{status}</div>

      {!showText && (
        state.recapActive ? (
          <button className="recap-btn" onClick={() => player.cancelRecap()}><Icon name="x" /> {t('skipRecap')}</button>
        ) : (
          <button className="recap-btn" onClick={() => openRecap('last')}><Icon name="history" /> {t('recapShort')}</button>
        )
      )}

      <div className={`opts ${showText ? 'sticky-bottom' : ''}`}>
        <button onClick={() => setSheet('speed')}><b>{fmtRate(settings.rate)}</b>{t('speedLbl')}</button>
        <button onClick={() => setSheet('voice')}><b>{voiceName || '—'}</b>{t('voiceLbl')}</button>
        <button className={state.sleepAt || state.sleepEndOfChapter ? 'on' : ''} onClick={() => setSheet('sleep')}>
          {state.sleepAt ? <b>{Math.max(1, Math.round((state.sleepAt - Date.now()) / 60000))}′</b> : <Icon name="moon" />}{t('dormir')}
        </button>
        <button className={showText ? 'on' : ''} onClick={() => { setShowText(!showText); setFollow(true); }}><Icon name="book" />{t('textLbl')}</button>
        <button className={marked ? 'on' : ''} onClick={mark}><Icon name="bookmark" />{marked ? t('marked') : t('markLbl')}</button>
      </div>

      {showText && !follow && (
        <button className="back-to-reading" onClick={() => setFollow(true)}>
          <Icon name="down" /> {t('backToReading')}
        </button>
      )}

      {showText && (
        <div className="dock with-progress">
          <div className="dock-progress">
            <input
              className="scrub"
              type="range"
              min="0"
              max="1000"
              value={Math.round((dragFrac ?? frac) * 1000)}
              onChange={(e) => setDragFrac(Number(e.target.value) / 1000)}
              onPointerUp={() => { if (dragFrac !== null) { player.goToFraction(dragFrac); setDragFrac(null); setFollow(true); } }}
              aria-label="progress"
            />
            <div className="marks">
              <span>{t('chapterLeft', { t: formatDuration(player.chapterRemainingMs(), t) })}</span>
              <span>{t('bookPct', { n: Math.round((dragFrac ?? frac) * 100) })}</span>
            </div>
          </div>
          <div className="dock-buttons">
            <button className="icon-btn" onClick={() => player.prevChapter()} aria-label="prev chapter"><Icon name="skipBack" /></button>
            <button className="icon-btn" onClick={() => player.prevSentence()} aria-label="prev"><Icon name="prev" /></button>
            {playBtn}
            <button className="icon-btn" onClick={() => player.nextSentence()} aria-label="next"><Icon name="next" /></button>
            <button className="icon-btn" onClick={() => openRecap('last')} aria-label={t('recap')}><Icon name="history" /></button>
          </div>
        </div>
      )}

      {coverOpen && (
        <CoverPicker t={t} book={book} onClose={() => setCoverOpen(false)} onPick={async (c) => {
          Object.assign(book, c);
          await updateBook(book.id, c);
          player._updateMetadata();
          setCoverOpen(false);
          onBookChanged?.();
        }} />
      )}

      {sheet && (
        <div className="sheet-bg" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            {sheet === 'chapters' && (
              <>
                <div className="tabs terra">
                  <button className={listTab === 'chapters' ? 'on' : ''} onClick={() => setListTab('chapters')}>{t('chapters')}</button>
                  <button className={listTab === 'marks' ? 'on' : ''} onClick={() => setListTab('marks')}>{t('bookmarks')} ({(book.bookmarks || []).length})</button>
                </div>
                {listTab === 'chapters' && settings.engine === 'supertonic' && (
                  <button className="btn block" onClick={() => player.prepareAll()}><Icon name="download" /> {t('prepAll')}</button>
                )}
                {listTab === 'marks' ? (
                  (book.bookmarks || []).length ? (
                    <div className="list">
                      {book.bookmarks.map((bm) => (
                        <div key={bm.id} className="row" style={{ borderBottom: '1px solid var(--line)' }}>
                          <button style={{ flex: 1, border: 'none', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }} onClick={() => { player.goToBookmark(bm); setSheet(null); }}>
                            <small style={{ marginLeft: 0 }}>{chapterLabel(book.lang, bm.chapter + 1, book.chapters[bm.chapter]?.title, book.chapters[bm.chapter]?.pages)}</small>
                            <span style={{ fontStyle: 'italic', fontSize: 15 }}>“{bm.snippet}…”</span>
                          </button>
                          <button className="icon-btn" style={{ border: 'none' }} onClick={() => player.removeBookmark(bm.id)} aria-label={t('deleteBook')}><Icon name="trash" /></button>
                        </div>
                      ))}
                    </div>
                  ) : <p className="muted">{t('noBookmarks')}</p>
                ) : (
                <div className="list">
                  {book.chapters.map((chp, i) => (
                    <button key={i} className={i === chIdx ? 'on' : ''} onClick={() => { player.goToChapter(i); setSheet(null); }}>
                      {chapterLabel(book.lang, i + 1, chp.title, chp.pages)}
                      <small>{(() => { const f = player.chapterPrepFraction(i); return f === null ? '' : f >= 1 ? t('prepReady') : state.preparing?.chapter === i ? t('prepPct', { n: Math.round(f * 100) }) : f > 0 ? t('prepPartial', { n: Math.round(f * 100) }) : ''; })()}</small>
                    </button>
                  ))}
                </div>
                )}
              </>
            )}
            {sheet === 'speed' && (
              <>
                <h3>{t('speed')}: {fmtRate(settings.rate)}</h3>
                <input className="scrub" type="range" min="0.5" max="3" step="0.05" value={settings.rate} onChange={(e) => setSettings({ rate: Number(e.target.value) })} />
                <div className="speeds">
                  {SPEEDS.map((s) => (
                    <button key={s} className={settings.rate === s ? 'on' : ''} onClick={() => setSettings({ rate: s })}>{fmtRate(s)}</button>
                  ))}
                </div>
              </>
            )}
            {sheet === 'voice' && (
              <>
                <h3>{t('whoReads')}</h3>
                <VoicePanel t={t} lang={book.lang} settings={settings} setSettings={setSettings} />
              </>
            )}
            {sheet === 'sleep' && (
              <>
                <h3>{t('sleep')}</h3>
                <div className="list">
                  <button onClick={() => { player.setSleep(0); setSheet(null); }}>{t('sleepOff')}</button>
                  {[10, 15, 30, 45, 60].map((m) => (
                    <button key={m} onClick={() => { player.setSleep(m); setSheet(null); }}>{t('sleepIn', { n: m })}</button>
                  ))}
                  <button onClick={() => { player.setSleep('chapter'); setSheet(null); }}>{t('sleepChapter')}</button>
                </div>
              </>
            )}
            {sheet === 'recap' && recap && recapAll && (
              <>
                <h3>{t('recapRefresh')}</h3>
                <div className="tabs terra">
                  <button className={recapTab === 'last' ? 'on' : ''} onClick={() => setRecapTab('last')}>{t('recapLast')}</button>
                  <button className={recapTab === 'all' ? 'on' : ''} onClick={() => setRecapTab('all')}>{t('recapAll')}</button>
                </div>
                {recapTab === 'last' ? (
                  recap.sentences.length ? (
                    <>
                      <span className="muted">{t('recapLastLead')}</span>
                      <ol className="recap jumpable">
                        {recap.points.map((pt, i) => (
                          <li key={i} onClick={() => jumpTo(pt)} role="button">{pt.s} <span className="go">{t('goThere')}</span></li>
                        ))}
                      </ol>
                    </>
                  ) : <p className="muted">{t('recapEmpty')}</p>
                ) : recapAll.items.length ? (
                  <>
                    <span className="muted">{t('recapAllLead', { title: book.title, n: Math.max(0, recapAll.chapterNumber - 1), total: book.chapters.length })}</span>
                    <div className="chsum">
                      {recapAll.items.map((it) => (
                        <div key={it.n} className="jumpable" role="button" onClick={() => jumpTo(it.points[0])}>
                          <b>{it.n}</b>
                          <span>
                            {it.title && !it.pages && <small>{it.title}</small>}
                            {it.lines.join(' ')} <span className="go">{t('goThere')}</span>
                          </span>
                        </div>
                      ))}
                      <div className="here"><b>{recapAll.chapterNumber}</b><span>{t('recapHere')}</span></div>
                    </div>
                  </>
                ) : <p className="muted">{t('recapEmpty')}</p>}
                {((recapTab === 'last' && recap.sentences.length > 0) || (recapTab === 'all' && recapAll.items.length > 0)) && (
                  <button className="btn primary block" onClick={() => { player.playRecap(recapLines()); setSheet(null); }}><Icon name="volume" /> {t('recapTellMe')}</button>
                )}
                <button className="btn block" onClick={() => { setSheet(null); if (!state.playing) player.play(); }}>{t('recapKeep')}</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Marca palabra por palabra lo que se va leyendo (estimado según el avance del audio).
function Karaoke({ text, active }) {
  const [frac, setFrac] = useState(null);
  useEffect(() => {
    if (!active) return setFrac(null);
    let raf;
    const loop = () => {
      const f = player.wordFraction();
      setFrac((old) => (f === null ? null : old !== null && Math.abs(old - f) < 0.01 ? old : f));
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [active, text]);
  const words = useMemo(() => {
    const out = [];
    const re = /\S+\s*/g;
    let m;
    while ((m = re.exec(text))) out.push({ w: m[0], at: m.index });
    return out;
  }, [text]);
  if (frac === null) return <>{text}</>;
  const target = frac * text.length;
  let cur = 0;
  words.forEach((x, i) => { if (x.at <= target) cur = i; });
  return (
    <>
      {words.map((x, i) => (
        <span key={i} className={i < cur ? 'w-read' : i === cur ? 'w-now' : 'w-next'}>{x.w}</span>
      ))}
    </>
  );
}

// Hoja rayada con la frase actual resaltada. Solo dibuja una "ventana" de párrafos: aguanta libros enormes.
// Si hacés scroll con el dedo, deja de seguir la lectura y aparece un botón para volver.
function Reader({ book, paras, cursor, t, playing, follow, setFollow }) {
  const curRef = useRef();
  const topRef = useRef();
  const bottomRef = useRef();
  const [range, setRange] = useState(() => [Math.max(0, cursor.p - 15), Math.min(paras.length, cursor.p + 40)]);
  const [from, to] = range;
  const starts = useMemo(() => new Map(book.chapters.map((c, i) => [c.start, i])), [book]);

  // Siguiendo la lectura: la ventana acompaña a la frase actual y la centra en pantalla.
  useEffect(() => {
    if (!follow) return;
    if (cursor.p < from + 3 || cursor.p > to - 10) setRange([Math.max(0, cursor.p - 15), Math.min(paras.length, cursor.p + 40)]);
    const id = requestAnimationFrame(() => curRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    return () => cancelAnimationFrame(id);
  }, [cursor.p, cursor.s, follow]);

  // Scroll con el dedo o la rueda: el usuario quiere mirar otra parte.
  useEffect(() => {
    const stop = () => setFollow(false);
    window.addEventListener('touchmove', stop, { passive: true });
    window.addEventListener('wheel', stop, { passive: true });
    return () => {
      window.removeEventListener('touchmove', stop);
      window.removeEventListener('wheel', stop);
    };
  }, []);

  // Al llegar arriba o abajo de lo dibujado, sumamos más párrafos.
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        if (e.target === topRef.current) setRange(([a, b]) => [Math.max(0, a - 30), b]);
        if (e.target === bottomRef.current) setRange(([a, b]) => [a, Math.min(paras.length, b + 30)]);
      }
    }, { rootMargin: '600px 0px' });
    if (topRef.current) io.observe(topRef.current);
    if (bottomRef.current) io.observe(bottomRef.current);
    return () => io.disconnect();
  }, [from, to]);

  const jump = (p) => {
    player.goToParagraph(p);
    setFollow(true);
    if (!player.playing) player.play();
  };

  const items = [];
  for (let p = from; p < to; p++) {
    if (starts.has(p)) {
      const i = starts.get(p);
      items.push(<div className="chap" key={'h' + p}>{t('chapterStartNote', { name: chapterLabel(book.lang, i + 1, book.chapters[i].title, book.chapters[i].pages).toLowerCase() })}</div>);
    }
    const isCur = p === cursor.p;
    if (isCur && !cursor.a) {
      const sents = player.sentencesOf(p);
      items.push(
        <p key={p} className="cur" onClick={() => jump(p)}>
          {sents.map((s, i) =>
            i === cursor.s ? (
              <mark key={i} ref={curRef} className="reading"><Karaoke text={s} active={playing} />{' '}</mark>
            ) : (
              <span key={i} className={i < cursor.s ? 'done' : ''}>{s} </span>
            )
          )}
        </p>
      );
    } else {
      items.push(<p key={p} ref={isCur ? curRef : null} className={isCur ? 'cur' : p < cursor.p ? 'done' : ''} onClick={() => jump(p)}>{paras[p]}</p>);
    }
  }
  return (
    <div className="page">
      <p className="note" style={{ fontSize: 19, margin: '0 0 32px', lineHeight: '32px', color: 'var(--terra)', cursor: 'default' }}>{t('tapToJump')}</p>
      <div ref={topRef} style={{ height: 1 }} />
      {items}
      <div ref={bottomRef} style={{ height: 1 }} />
    </div>
  );
}
