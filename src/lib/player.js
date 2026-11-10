// Motor de reproducción: recorre el libro frase por frase, anuncia capítulos,
// genera la voz por adelantado (para libros enormes) y recuerda la posición.
import { splitSentences, summarize, summarizeWithPos, keyNames } from './text.js';
import { saveProgress, updateBook, getAudio, putAudio, audioKeys, deleteAudio } from './db.js';
import { systemVoices } from './voices.js';
import { announce, chapterLabel } from './i18n.js';
import { summarizeChapter } from './ai.js';
import { localAi } from './localAi.js';

// Cuántas frases se generan por adelantado con la voz natural.
// Más margen = sigue sonando aunque el celular bloqueado frene un poco la app.
const PREFETCH = 8;

// Un WAV de silencio en loop mantiene viva la sesión de audio con la pantalla bloqueada.
function silentWavUrl(seconds = 2, rate = 8000) {
  const n = seconds * rate;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

class PiperClient {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.seq = 0;
    this.onDownload = null;
  }
  ensure() {
    if (this.worker) return;
    this.worker = new Worker(new URL('./piperWorker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'download') return this.onDownload?.(m);
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.type === 'result' ? p.resolve(m.blob) : p.reject(new Error(m.message));
    };
  }
  synth(voiceId, text) {
    this.ensure();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, voiceId, text, base: new URL('.', document.baseURI).href });
    });
  }
}

class SupertonicClient {
  constructor() { this.worker = null; this.pending = new Map(); this.seq = 0; this.onDownload = null; }
  ensure() {
    if (this.worker) return;
    this.worker = new Worker(new URL('./supertonicWorker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'download') return this.onDownload?.(m);
      if (m.type === 'engine') return (this.ep = m.ep);
      if (m.type === 'timing') return (this.lastTiming = m);
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.type === 'error' ? p.reject(new Error(m.message)) : p.resolve(m.type === 'status' ? m.downloaded : m.blob ?? true);
    };
  }
  _send(msg) {
    this.ensure();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id, base: new URL('.', document.baseURI).href });
    });
  }
  synth(voice, text, lang) { return this._send({ type: 'synth', voice, text, lang }); }
  download() { return this._send({ type: 'download' }); }
  isDownloaded() { return this._send({ type: 'status' }); }
  voices() { return this._send({ type: 'voices' }); }
  addVoice(voice) { return this._send({ type: 'addVoice', voice }); }
  removeVoice(voice) { return this._send({ type: 'removeVoice', voice }); }
}

export class Player {
  constructor() {
    this.audio = new Audio();
    this.audio.preservesPitch = true;
    this.audio.addEventListener('ended', () => this._onItemEnd());
    this.audio.addEventListener('playing', () => (this._lastActivity = Date.now()));
    this.audio.addEventListener('timeupdate', () => (this._lastActivity = Date.now()));
    this.audio.addEventListener('error', () => this.playing && this._onItemEnd());
    this.piper = new PiperClient();
    this.piper.onDownload = (m) => this._emit({ download: m.total ? m.loaded / m.total : 0 });
    this.supertonic = new SupertonicClient();
    this.supertonic.onDownload = (m) => this._emit({ download: m.loaded });
    this.stVoice = {};
    this.listeners = new Set();
    this.book = null;
    this.paras = [];
    this.cursor = null;
    this.playing = false;
    this.loading = false;
    this.rate = 1;
    this.engine = 'supertonic';
    this.piperVoice = {};
    this.systemVoice = {};
    this.cache = new Map();
    this.token = 0;
    this.sleepAt = null;
    this.sleepEndOfChapter = false;
    this.extraQueue = null; // para el resumen
    this.lastError = null;
    this.keepAlive = new Audio();
    this.keepAlive.loop = true;
    this.keepAlive.volume = 0.01;
    this.keepAlive.setAttribute('playsinline', '');
    this.audio.setAttribute('playsinline', '');
    this._setupMediaSession();
    // Al volver a la app (desbloquear), si quedó trabada, sigue sola.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this._watchdog();
      });
    }
  }

  _startKeepAlive() {
    try {
      if (!this.keepAlive.src) this.keepAlive.src = silentWavUrl();
      this.keepAlive.play().catch(() => {});
    } catch {}
    const ms = typeof navigator !== 'undefined' && navigator.mediaSession;
    if (ms) ms.playbackState = 'playing';
    clearInterval(this._wd);
    this._wd = setInterval(() => this._watchdog(), 5000);
  }
  _stopKeepAlive() {
    try { this.keepAlive.pause(); } catch {}
    const ms = typeof navigator !== 'undefined' && navigator.mediaSession;
    if (ms) ms.playbackState = 'paused';
    clearInterval(this._wd);
  }
  // Detecta si debería estar sonando pero no suena nada, y retoma.
  _watchdog() {
    if (!this.playing || this.loading) return;
    const audioIdle = this.audio.paused || this.audio.ended;
    // La voz del celular a veces no informa que está hablando: le damos el tiempo estimado de la frase.
    const sysBusy = this._sysStart && Date.now() - this._sysStart < ((this._sysLen || 0) / (15 * this.rate)) * 1000 + 4000;
    const sysIdle = typeof speechSynthesis === 'undefined' || (!speechSynthesis.speaking && !speechSynthesis.pending && !sysBusy);
    const idleFor = Date.now() - (this._lastActivity || 0);
    if (audioIdle && sysIdle && idleFor > 4000) this._speakCurrent();
  }

  /* ---------- suscripción para la interfaz ---------- */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  _emit(extra = {}) {
    const s = this.state(extra);
    this.listeners.forEach((fn) => fn(s));
  }
  state(extra = {}) {
    return {
      bookId: this.book?.id || null,
      cursor: this.cursor,
      playing: this.playing,
      loading: this.loading,
      rate: this.rate,
      chapterIndex: this.cursor ? this.chapterIndexOf(this.cursor.p) : 0,
      sleepAt: this.sleepAt,
      sleepEndOfChapter: this.sleepEndOfChapter,
      recapActive: !!this.extraQueue,
      preparing: this.preparing || null,
      usingFallback: !!this.usingFallback && this.playing,
      error: this.lastError,
      ...extra,
    };
  }

  /* ---------- carga ---------- */
  load(book, paras) {
    this.stop();
    this.book = book;
    this.paras = paras;
    this.cache.clear();
    const pos = book.progress;
    const p = Math.min(pos?.p || 0, paras.length - 1);
    const s = pos?.s || 0;
    this.cursor = p === 0 && s === 0 && !pos?.finished ? { p: 0, s: 0, a: 'start' } : { p, s, a: null };
    this.offsets = [];
    let acc = 0;
    paras.forEach((t) => {
      this.offsets.push(acc);
      acc += t.length;
    });
    this.totalChars = acc;
    this._ccache = new Map();
    this.prepQueue = [];
    this._updateMetadata();
    this._emit();
    this._initPrep();
  }

  configure({ rate, engine, piperVoice, systemVoice, stVoice, aiKey, aiLocal }) {
    if (aiKey !== undefined) this.aiKey = (aiKey || '').trim();
    if (aiLocal !== undefined) this.aiLocal = !!aiLocal;
    let voiceChanged = false;
    if (rate !== undefined) {
      this.rate = rate;
      this.audio.playbackRate = rate;
    }
    if (engine !== undefined && engine !== this.engine) {
      this.engine = engine;
      voiceChanged = true;
    }
    if (piperVoice && JSON.stringify(piperVoice) !== JSON.stringify(this.piperVoice)) {
      this.piperVoice = { ...piperVoice };
      voiceChanged = true;
    }
    if (stVoice && JSON.stringify(stVoice) !== JSON.stringify(this.stVoice)) {
      this.stVoice = { ...stVoice };
      voiceChanged = true;
    }
    if (systemVoice) this.systemVoice = { ...systemVoice };
    if (voiceChanged) {
      setTimeout(() => this._initPrep(), 0);
      this.cache.clear();
      if (this.playing) this._restart();
    } else if (rate !== undefined && this.playing && this.engine === 'system') this._restart();
    this._emit();
  }

  /* ---------- capítulos y posición ---------- */
  chapterIndexOf(p) {
    const ch = this.book?.chapters || [];
    let lo = 0, hi = ch.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ch[mid].start <= p) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  sentencesOf(p) {
    if (!this.book) return [];
    return splitSentences(this.paras[p] || '', this.book.lang);
  }
  bookProgress(cursor = this.cursor) {
    if (!cursor || !this.totalChars) return 0;
    const sents = this.sentencesOf(cursor.p);
    const within = sents.slice(0, cursor.s).reduce((n, s) => n + s.length + 1, 0);
    return Math.min(1, (this.offsets[cursor.p] + within) / this.totalChars);
  }
  chapterProgress(cursor = this.cursor) {
    if (!cursor) return 0;
    const ch = this.book.chapters[this.chapterIndexOf(cursor.p)];
    const a = this.offsets[ch.start];
    const b = ch.end < this.paras.length ? this.offsets[ch.end] : this.totalChars;
    return b > a ? (this.offsets[cursor.p] - a) / (b - a) : 0;
  }
  chapterRemainingMs() {
    if (!this.cursor) return 0;
    const ch = this.book.chapters[this.chapterIndexOf(this.cursor.p)];
    const end = ch.end < this.paras.length ? this.offsets[ch.end] : this.totalChars;
    const sents = this.sentencesOf(this.cursor.p);
    const within = sents.slice(0, this.cursor.s).reduce((n, x) => n + x.length + 1, 0);
    const left = Math.max(0, end - (this.offsets[this.cursor.p] + within));
    return (left / 900 / this.rate) * 60000;
  }
  remainingMs() {
    return ((this.totalChars * (1 - this.bookProgress())) / 900 / this.rate) * 60000;
  }

  _next(c) {
    const chapters = this.book.chapters;
    const ch = chapters[this.chapterIndexOf(c.p)];
    if (c.a === 'start') {
      // Si el primer párrafo es el mismo título que ya se anunció, no lo repetimos.
      const norm = (x) => (x || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      const skip = ch.end - ch.start > 1 && ch.title && norm(this.paras[ch.start]) === norm(ch.title);
      return { p: ch.start + (skip ? 1 : 0), s: 0, a: null };
    }
    if (c.a === 'end') {
      if (ch.end >= this.paras.length) return null;
      return { p: ch.end, s: 0, a: 'start' };
    }
    if (c.s + 1 < this.sentencesOf(c.p).length) return { p: c.p, s: c.s + 1, a: null };
    if (c.p + 1 < ch.end) return { p: c.p + 1, s: 0, a: null };
    return { p: c.p, s: c.s, a: 'end' };
  }
  _prev(c) {
    if (c.a === 'end') return { p: c.p, s: c.s, a: null };
    if (c.s > 0) return { p: c.p, s: c.s - 1, a: null };
    if (c.p > 0) return { p: c.p - 1, s: this.sentencesOf(c.p - 1).length - 1, a: null };
    return { p: 0, s: 0, a: null };
  }
  _textOf(c) {
    const idx = this.chapterIndexOf(c.p);
    const ch = this.book.chapters[idx];
    if (c.a === 'start') return announce(this.book.lang, 'start', idx + 1, ch.title, ch.pages);
    if (c.a === 'end') return announce(this.book.lang, 'end', idx + 1, ch.title, ch.pages);
    return this.sentencesOf(c.p)[c.s] || '';
  }
  _key(c) {
    return `${c.p}:${c.s}:${c.a || ''}`;
  }

  /* ---------- controles ---------- */
  async play() {
    if (!this.book) return;
    if (!this.cursor) this.cursor = { p: 0, s: 0, a: 'start' };
    this.playing = true;
    this._startKeepAlive();
    this._emit();
    this._speakCurrent();
  }
  pause() {
    this.playing = false;
    this._stopKeepAlive();
    this.token++;
    this.audio.pause();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    this.loading = false;
    this._save();
    this._emit();
  }
  toggle() {
    this.playing ? this.pause() : this.play();
  }
  stop() {
    if (this.playing) this.pause();
    this.extraQueue = null;
  }
  _restart() {
    this.token++;
    this.audio.pause();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    this._speakCurrent();
  }
  seek(cursor) {
    this.extraQueue = null;
    this.cursor = cursor;
    this._save();
    this._emit();
    if (this.playing) this._restart();
    const idx = this.chapterIndexOf(cursor.p);
    this.prepQueue = (this.prepQueue || []).filter((i) => i === this.prepQueue[0]);
    this.prepare([idx, idx + 1]);
  }
  nextSentence() {
    let c = this._next(this.cursor);
    while (c && c.a) c = this._next(c);
    if (c) this.seek(c);
  }
  prevSentence() {
    this.seek(this._prev(this.cursor));
  }
  nextChapter() {
    const idx = this.chapterIndexOf(this.cursor.p);
    const ch = this.book.chapters[idx + 1];
    if (ch) this.seek({ p: ch.start, s: 0, a: 'start' });
  }
  prevChapter() {
    const idx = this.chapterIndexOf(this.cursor.p);
    const ch = this.book.chapters[idx];
    // Si ya empezó el capítulo, vuelve a su inicio; si no, al anterior.
    const target = this.cursor.p > ch.start || this.cursor.s > 2 || idx === 0 ? ch : this.book.chapters[idx - 1];
    this.seek({ p: target.start, s: 0, a: 'start' });
  }
  goToChapter(i) {
    const ch = this.book.chapters[i];
    if (ch) this.seek({ p: ch.start, s: 0, a: 'start' });
  }
  goToParagraph(p) {
    this.seek({ p: Math.max(0, Math.min(this.paras.length - 1, p)), s: 0, a: null });
  }
  goToFraction(f) {
    const target = f * this.totalChars;
    let lo = 0, hi = this.offsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.offsets[mid] <= target) lo = mid;
      else hi = mid - 1;
    }
    this.goToParagraph(lo);
  }

  /* ---------- palabra que se está leyendo (0..1 dentro de la frase) ---------- */
  wordFraction() {
    if (!this.playing || this.extraQueue || this.loading || !this.cursor || this.cursor.a) return null;
    if (this.engine === 'system' || this.usingFallback) {
      if (!this._sysLen) return null;
      // Si el celular avisa la palabra exacta, la usamos; si no, estimamos por tiempo (~15 letras por segundo).
      if (this._sysBoundary) return this._sysChar / this._sysLen;
      const elapsed = (Date.now() - (this._sysStart || Date.now())) / 1000;
      return Math.min(1, (elapsed * 15 * this.rate) / this._sysLen);
    }
    const d = this.audio.duration;
    if (!d || !isFinite(d)) return null;
    // La voz deja un pequeño silencio al final: lo descontamos para no adelantarnos.
    return Math.min(1, this.audio.currentTime / Math.max(0.3, d - 0.25));
  }

  /* ---------- marcadores a mano ---------- */
  addBookmark() {
    if (!this.book || !this.cursor) return null;
    const c = this.cursor;
    const idx = this.chapterIndexOf(c.p);
    const snippet = (this.sentencesOf(c.p)[c.a ? 0 : c.s] || '').slice(0, 120);
    const bm = { id: Date.now(), p: c.p, s: c.a ? 0 : c.s, chapter: idx, snippet, at: Date.now() };
    this.book.bookmarks = [...(this.book.bookmarks || []), bm].sort((a, b) => a.p - b.p || a.s - b.s);
    updateBook(this.book.id, { bookmarks: this.book.bookmarks });
    this._emit({ bookmarked: bm.id });
    return bm;
  }
  removeBookmark(id) {
    this.book.bookmarks = (this.book.bookmarks || []).filter((b) => b.id !== id);
    updateBook(this.book.id, { bookmarks: this.book.bookmarks });
    this._emit();
  }
  goToBookmark(bm) {
    this.seek({ p: bm.p, s: bm.s, a: null });
  }

  setSleep(minutes) {
    clearTimeout(this.sleepTimer);
    this.sleepEndOfChapter = minutes === 'chapter';
    this.sleepAt = null;
    if (typeof minutes === 'number' && minutes > 0) {
      this.sleepAt = Date.now() + minutes * 60000;
      this.sleepTimer = setTimeout(() => {
        this.sleepAt = null;
        this.pause();
      }, minutes * 60000);
    }
    this._emit();
  }

  /* ---------- resumen "¿Dónde estaba?" ---------- */
  buildRecap() {
    const c = this.cursor || { p: 0 };
    const lang = this.book.lang;
    const idx = this.chapterIndexOf(c.p);
    const ch = this.book.chapters[idx];
    // Tomamos lo último leído: unos ~12.000 caracteres hacia atrás.
    let from = c.p;
    let chars = 0;
    while (from > 0 && chars < 12000) {
      from--;
      chars += this.paras[from].length;
    }
    const recent = this.paras.slice(from, c.p + 1);
    if (c.p === 0 && c.s === 0) return { chapterNumber: idx + 1, chapterTitle: ch.title, pages: ch.pages, sentences: [], points: [], sections: [] };
    // Partimos lo último leído en hasta 4 secciones de largo parecido; cada una con sus nombres clave y 2 frases.
    const total = recent.reduce((n, p) => n + p.length, 0);
    const parts = Math.max(1, Math.min(4, Math.round(total / 2500)));
    const sections = [];
    let start = 0;
    for (let k = 0; k < parts; k++) {
      let acc = 0;
      let end = start;
      const goal = total / parts;
      while (end < recent.length && (acc < goal || k === parts - 1)) acc += recent[end++].length;
      const slice = recent.slice(start, end);
      if (slice.length) {
        const pts = summarizeWithPos(slice, lang, 2, from + start);
        if (pts.length) sections.push({ names: keyNames(slice, lang, 3), points: pts, start: from + start, end: from + end });
      }
      start = end;
    }
    const points = sections.flatMap((x) => x.points);
    return { chapterNumber: idx + 1, chapterTitle: ch.title, pages: ch.pages, sentences: points.map((x) => x.s), points, sections };
  }
  // Resumen de todo el libro hasta donde vas: un renglón (o dos) por capítulo escuchado.
  buildRecapAll() {
    const c = this.cursor || { p: 0 };
    const lang = this.book.lang;
    const idx = this.chapterIndexOf(c.p);
    const items = [];
    for (let i = 0; i <= idx; i++) {
      const ch = this.book.chapters[i];
      const end = i === idx ? c.p : ch.end;
      if (end <= ch.start) continue;
      const slice = this.paras.slice(ch.start, end);
      const chars = slice.reduce((n, p) => n + p.length, 0);
      const points = summarizeWithPos(slice, lang, chars > 6000 ? 2 : 1, ch.start);
      if (points.length) items.push({ n: i + 1, title: ch.title, pages: ch.pages, names: keyNames(slice, lang, 3), lines: points.map((x) => x.s), points, partial: i === idx });
    }
    return { chapterNumber: idx + 1, items };
  }
  /* ---------- resúmenes con IA (Gemini) por capítulo ---------- */
  // Resume los capítulos hasta 'upTo' que todavía no tengan resumen (el actual, solo hasta donde vas).
  async ensureAiSummaries(upTo, onUpdate) {
    if (!(this.aiKey || this.aiLocal) || !this.book || this._aiRunning) return;
    this._aiRunning = true;
    this.aiError = null;
    const book = this.book;
    const cur = this.chapterIndexOf(this.cursor?.p || 0);
    try {
      for (let i = 0; i <= Math.min(upTo, book.chapters.length - 1); i++) {
        if (this.book !== book) break;
        const ch = book.chapters[i];
        const isCur = i === cur;
        const upto = isCur ? this.cursor.p : ch.end;
        if (upto <= ch.start) continue;
        const have = book.aiSummaries?.[i];
        if (have && (have.full || (isCur && have.upto >= upto - 1))) continue;
        const text = this.paras.slice(ch.start, upto).join('\n\n');
        if (text.length < 200) continue;
        this.aiBusy = i;
        onUpdate?.();
        try {
          const chapterName = chapterLabel(book.lang, i + 1, ch.title, ch.pages);
          // Siempre primero la IA propia del celular (3 frases: principio, medio y final).
          const summary = this.aiLocal || !this.aiKey
            ? await localAi.summarize(this.paras.slice(ch.start, upto), { lang: book.lang, bookTitle: book.title, chapterName, sentences: 3 })
            : await summarizeChapter(this.aiKey, { text, lang: book.lang, bookTitle: book.title, chapterName, partial: isCur });
          book.aiSummaries = { ...(book.aiSummaries || {}), [i]: { text: summary, upto, full: !isCur } };
          updateBook(book.id, { aiSummaries: book.aiSummaries });
        } catch (e) {
          this.aiError = e.code || 'other';
          if (['key', 'quota', 'network'].includes(this.aiError)) break;
        }
        onUpdate?.();
      }
    } finally {
      this.aiBusy = null;
      this._aiRunning = false;
      onUpdate?.();
    }
  }

  // Con clave de Gemini: una línea de resumen para cada parte de "Lo último" (se guardan para no repetir).
  async ensureAiSectionTitles(sections, onUpdate) {
    if (!(this.aiKey || this.aiLocal) || !this.book || this._aiSecRunning) return;
    this._aiSecRunning = true;
    const book = this.book;
    try {
      for (const sec of sections) {
        const k = `${sec.start}-${sec.end}`;
        if (book.aiSections?.[k]) {
          sec.ai = book.aiSections[k];
          continue;
        }
        const text = this.paras.slice(sec.start, sec.end).join(' ');
        if (text.length < 200) continue;
        sec.aiBusy = true;
        onUpdate?.();
        try {
          const chapterName = book.lang === 'en' ? 'a passage' : 'un fragmento';
          sec.ai = this.aiLocal || !this.aiKey
            ? await localAi.summarize(this.paras.slice(sec.start, sec.end), { lang: book.lang, bookTitle: book.title, chapterName, sentences: 1 })
            : await summarizeChapter(this.aiKey, { text, lang: book.lang, bookTitle: book.title, chapterName, partial: false });
          book.aiSections = { ...(book.aiSections || {}), [k]: sec.ai };
          updateBook(book.id, { aiSections: book.aiSections });
        } catch (e) {
          this.aiError = e.code || 'other';
          sec.aiBusy = false;
          break;
        }
        sec.aiBusy = false;
        onUpdate?.();
      }
    } finally {
      this._aiSecRunning = false;
      onUpdate?.();
    }
  }

  playRecap(lines) {
    this.token++;
    this.audio.pause();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    this.extraQueue = [...lines];
    this.playing = true;
    this._startKeepAlive();
    this._emit();
    this._speakCurrent();
  }
  cancelRecap() {
    if (!this.extraQueue) return;
    this.extraQueue = null;
    if (this.playing) this._restart();
    this._emit();
  }

  /* ---------- síntesis ---------- */
  _voiceFor() {
    const lang = this.book.lang;
    return this.engine === 'supertonic' ? this.stVoice[lang] : this.piperVoice[lang];
  }
  /* ---------- audio preparado por adelantado (solo voz Supertonic) ---------- */
  _akey(c, voice = this._voiceFor()) {
    return `${this.book.id}|${voice}|c${this.chapterIndexOf(c.p)}|${c.p}:${c.s}:${c.a || ''}`;
  }
  _chapterCursors(i) {
    this._ccache ||= new Map();
    const ck = `${this.book.id}|${i}`;
    if (this._ccache.has(ck)) return this._ccache.get(ck);
    const ch = this.book.chapters[i];
    const out = [];
    let c = { p: ch.start, s: 0, a: 'start' };
    while (c && this.chapterIndexOf(c.p) === i) {
      out.push(c);
      if (c.a === 'end') break;
      c = this._next(c);
    }
    this._ccache.set(ck, out);
    return out;
  }
  chapterPrepFraction(i) {
    if (this.engine !== 'supertonic' || !this.book?.chapters[i]) return null;
    const total = this._chapterCursors(i).length;
    return total ? Math.min(1, (this.prepCount?.[i] || 0) / total) : 0;
  }
  // Devuelve el audio de una frase: del celular si ya está preparado; si no, lo genera y lo guarda.
  _getOrMakeAudio(c, text) {
    const voice = this._voiceFor();
    const k = this._akey(c, voice);
    this.inflight ||= new Map();
    if (this.inflight.has(k)) return this.inflight.get(k);
    const lang = this.book.lang;
    const chapter = this.chapterIndexOf(c.p);
    const job = (async () => {
      const stored = await getAudio(k);
      if (stored) return stored;
      const blob = await this.supertonic.synth(voice, text, lang);
      await putAudio(k, blob);
      this._markPrepared(k, chapter);
      return blob;
    })();
    this.inflight.set(k, job);
    job.finally(() => this.inflight.delete(k)).catch(() => {});
    return job;
  }
  _markPrepared(k, chapter) {
    this.prepared ||= new Set();
    if (this.prepared.has(k)) return;
    this.prepared.add(k);
    this.prepCount ||= {};
    this.prepCount[chapter] = (this.prepCount[chapter] || 0) + 1;
  }
  async _initPrep() {
    if (!this.book || this.engine !== 'supertonic') return;
    const id = this.book.id;
    const voice = this._voiceFor();
    if (!voice) return;
    // Si cambió la voz, borramos el audio de las voces anteriores de este libro.
    const all = await audioKeys(`${id}|`);
    const stale = new Set(all.filter((k) => !k.startsWith(`${id}|${voice}|`)).map((k) => k.split('|')[1]));
    for (const v of stale) await deleteAudio(`${id}|${v}|`);
    this.prepared = new Set();
    this.prepCount = {};
    for (const k of all) if (k.startsWith(`${id}|${voice}|`)) this._markPrepared(k, Number(k.split('|')[2].slice(1)));
    this.prepQueue = [];
    const cur = this.chapterIndexOf(this.cursor?.p || 0);
    this._cleanupChapters(cur);
    this.prepare([cur, cur + 1]);
  }
  // Borra lo ya escuchado (deja el capítulo anterior por si querés volver).
  _cleanupChapters(cur) {
    const id = this.book.id;
    const voice = this._voiceFor();
    for (let i = 0; i < cur - 1; i++) {
      if (!this.prepCount?.[i]) continue;
      deleteAudio(`${id}|${voice}|c${i}|`);
      this.prepCount[i] = 0;
      for (const k of [...(this.prepared || [])]) if (k.startsWith(`${id}|${voice}|c${i}|`)) this.prepared.delete(k);
    }
  }
  prepare(chapters) {
    if (!this.book || this.engine !== 'supertonic') return;
    this.prepQueue ||= [];
    for (const i of chapters) if (i >= 0 && i < this.book.chapters.length && !this.prepQueue.includes(i) && (this.chapterPrepFraction(i) ?? 1) < 1) this.prepQueue.push(i);
    this._prepLoop();
  }
  prepareAll() {
    const cur = this.chapterIndexOf(this.cursor?.p || 0);
    this.prepare(this.book.chapters.map((_, i) => i).filter((i) => i >= cur));
  }
  async _prepLoop() {
    if (this._prepping) return;
    this._prepping = true;
    try {
      while (this.prepQueue?.length && this.engine === 'supertonic' && this.book) {
        const i = this.prepQueue[0];
        const bookId = this.book.id;
        const voice = this._voiceFor();
        for (const c of this._chapterCursors(i)) {
          if (!this.book || this.book.id !== bookId || this._voiceFor() !== voice || this.engine !== 'supertonic') break;
          if (this.prepared?.has(this._akey(c, voice))) continue;
          // Si el reproductor está esperando una frase, le damos prioridad.
          // Si el reproductor espera una frase, o la IA está resumiendo (usan la misma placa de video), esperamos.
          while (this.loading || this._aiRunning || this._aiSecRunning) await new Promise((r) => setTimeout(r, 300));
          const text = this._textOf(c);
          if (!text) continue;
          await this._getOrMakeAudio(c, text);
          this.preparing = { chapter: i, frac: this.chapterPrepFraction(i) };
          this._emit();
        }
        this.prepQueue.shift();
      }
    } catch (e) {
      console.warn('No se pudo preparar el audio', e);
      this.prepQueue = [];
    }
    this.preparing = null;
    this._prepping = false;
    this._emit();
  }

  _synthPiper(text, key) {
    const voice = this._voiceFor();
    const k = `${this.engine}|${voice}|${key}|${text.length}`;
    if (!this.cache.has(k)) {
      let job;
      if (this.engine === 'supertonic' && !key.startsWith('recap:')) {
        const [p, s, a] = key.split(':');
        job = this._getOrMakeAudio({ p: Number(p), s: Number(s), a: a || null }, text);
      } else job = this.engine === 'supertonic' ? this.supertonic.synth(voice, text, this.book.lang) : this.piper.synth(voice, text);
      const pr = job.then((blob) => URL.createObjectURL(blob));
      pr.catch(() => this.cache.delete(k));
      this.cache.set(k, pr);
      if (this.cache.size > 40) {
        const [oldK, oldP] = this.cache.entries().next().value;
        this.cache.delete(oldK);
        oldP.then((u) => setTimeout(() => URL.revokeObjectURL(u), 60000)).catch(() => {});
      }
    }
    return this.cache.get(k);
  }
  _prefetch() {
    if (this.engine !== 'piper' || this.extraQueue) return;
    let c = this.cursor;
    for (let i = 0; i < PREFETCH; i++) {
      c = c && this._next(c);
      if (!c) break;
      const t = this._textOf(c);
      if (t) this._synthPiper(t, this._key(c));
    }
  }

  async _speakCurrent() {
    const token = ++this.token;
    this._lastActivity = Date.now();
    let text, key;
    if (this.extraQueue) {
      if (!this.extraQueue.length) {
        this.extraQueue = null;
        this._emit();
        return this._speakCurrent();
      }
      text = this.extraQueue[0];
      key = 'recap:' + text.slice(0, 30);
    } else {
      if (!this.cursor) return;
      text = this._textOf(this.cursor);
      key = this._key(this.cursor);
      this._saveThrottled();
    }
    this._emit();
    if (!text) return this._onItemEnd(token);

    // Modo híbrido: con Supertonic, lo que todavía no está preparado lo lee la voz del celular
    // para no cortar la lectura; mientras tanto se sigue preparando lo que viene.
    if (this.engine === 'supertonic' && typeof speechSynthesis !== 'undefined') {
      const ready = !this.extraQueue && this.cursor && this.prepared?.has(this._akey(this.cursor));
      this.usingFallback = !ready;
      if (!ready) {
        this._emit();
        return this._speakSystem(text, token);
      }
    } else this.usingFallback = false;

    if (this.engine !== 'system' && this._voiceFor()) {
      this.loading = true;
      this._emit();
      try {
        const urlP = this._synthPiper(text, key);
        this._prefetch();
        const url = await urlP;
        if (token !== this.token) return;
        this.loading = false;
        this.lastError = null;
        this.audio.src = url;
        this.audio.playbackRate = this.rate;
        this.audio.preservesPitch = true;
        await this.audio.play();
        this._emit();
      } catch (err) {
        if (token !== this.token) return;
        console.error(err);
        this.loading = false;
        // Si falla Supertonic probamos Piper; si falla Piper, la voz del celular.
        this.lastError = this.engine;
        this.engine = this.engine === 'supertonic' ? 'piper' : 'system';
        this._emit();
        if (this.engine === 'piper') return this._speakCurrent();
        this._emit();
        this._speakSystem(text, token);
      }
    } else {
      this._speakSystem(text, token);
    }
  }

  _speakSystem(text, token) {
    if (typeof speechSynthesis === 'undefined') return;
    const lang = this.book.lang;
    const u = new SpeechSynthesisUtterance(text);
    const voices = systemVoices(lang);
    const chosen = voices.find((v) => v.voiceURI === this.systemVoice[lang]) || voices[0];
    if (chosen) u.voice = chosen;
    u.lang = chosen?.lang || (lang === 'es' ? 'es-AR' : 'en-US');
    u.rate = Math.min(3, Math.max(0.5, this.rate));
    this._sysChar = 0;
    this._sysLen = text.length;
    this._sysBoundary = false;
    this._sysStart = Date.now();
    u.onstart = () => (this._sysStart = Date.now());
    u.onboundary = (e) => { if (e.name === 'word' || e.charIndex) { this._sysChar = e.charIndex; this._sysBoundary = true; } };
    u.onend = () => token === this.token && this._onItemEnd(token);
    u.onerror = (e) => {
      if (token === this.token && e.error !== 'interrupted' && e.error !== 'canceled') this._onItemEnd(token);
    };
    speechSynthesis.speak(u);
  }

  _onItemEnd(token) {
    if (token !== undefined && token !== this.token) return;
    if (!this.playing) return;
    if (this.extraQueue) {
      this.extraQueue.shift();
      return this._speakCurrent();
    }
    const wasEnd = this.cursor.a === 'end';
    const next = this._next(this.cursor);
    if (!next) {
      this.playing = false;
      this._stopKeepAlive();
      this._save(true);
      this._emit({ finished: true });
      return;
    }
    this.cursor = next;
    if (next.a === 'start') {
      // Empezó un capítulo nuevo: preparamos el siguiente y limpiamos lo ya escuchado.
      const idx = this.chapterIndexOf(next.p);
      this._cleanupChapters(idx);
      this.prepare([idx, idx + 1]);
      if ((this.aiKey || this.aiLocal) && idx > 0) this.ensureAiSummaries(idx - 1);
    }
    if (wasEnd && this.sleepEndOfChapter) {
      this.sleepEndOfChapter = false;
      this.pause();
      return;
    }
    this._speakCurrent();
  }

  /* ---------- guardar posición ---------- */
  _save(finished = false) {
    if (!this.book || !this.cursor) return;
    const data = { p: this.cursor.p, s: this.cursor.s, fraction: finished ? 1 : this.bookProgress(), finished: finished || undefined, listenedAt: Date.now() };
    this.book.progress = { ...data, updatedAt: Date.now() };
    saveProgress(this.book.id, data);
  }
  _saveThrottled() {
    const now = Date.now();
    if (!this._lastSave || now - this._lastSave > 4000) {
      this._lastSave = now;
      this._save();
    }
  }

  /* ---------- pantalla bloqueada / auriculares ---------- */
  _setupMediaSession() {
    const ms = typeof navigator !== 'undefined' && navigator.mediaSession;
    if (!ms) return;
    const safe = (a, fn) => {
      try {
        ms.setActionHandler(a, fn);
      } catch {}
    };
    safe('play', () => this.play());
    safe('pause', () => this.pause());
    safe('previoustrack', () => this.prevChapter());
    safe('nexttrack', () => this.nextChapter());
    safe('seekbackward', () => this.prevSentence());
    safe('seekforward', () => this.nextSentence());
  }
  _updateMetadata() {
    const ms = typeof navigator !== 'undefined' && navigator.mediaSession;
    if (!ms || !this.book || typeof MediaMetadata === 'undefined') return;
    const artwork = this.book.cover ? [{ src: URL.createObjectURL(this.book.cover), sizes: '400x600' }] : this.book.coverUrl ? [{ src: this.book.coverUrl }] : [];
    ms.metadata = new MediaMetadata({ title: this.book.title, artist: this.book.author || 'Oílo', album: 'Oílo', artwork });
  }
}

export const player = new Player();
