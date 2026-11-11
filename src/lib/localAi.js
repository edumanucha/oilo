// Cliente de la IA local (corre en un hilo aparte). Resume capítulos en 3 frases sin clave ni internet.
export const LOCAL_AI_MB = 770;
const PART_CHARS = 5000; // cada fragmento que lee la IA (un modelo chico rinde mejor con textos cortos)

class LocalAi {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.seq = 0;
    this.onDownload = null;
    this.device = null;
  }
  ensure() {
    if (this.worker) return;
    this.worker = new Worker(new URL('./localAiWorker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'download') return this.onDownload?.(m.loaded);
      if (m.type === 'engine') return (this.device = m.device);
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.type === 'error' ? p.reject(new Error(m.message)) : p.resolve(m.value);
      if (!this.pending.size) this._scheduleIdle();
    };
  }
  _send(msg) {
    this.ensure();
    clearTimeout(this._idle);
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id });
    });
  }
  // La IA ocupa ~1 GB de memoria mientras está cargada: al terminar de resumir, se descarga sola.
  _scheduleIdle() {
    clearTimeout(this._idle);
    this._idle = setTimeout(() => this.unloadIfIdle(), 15000);
  }
  unloadIfIdle() {
    if (this.pending.size || !this.worker) return false;
    clearTimeout(this._idle);
    this.worker.terminate();
    this.worker = null;
    return true;
  }
  get busy() { return this.pending.size > 0; }
  isDownloaded() { return this._send({ type: 'status' }); }
  download() { return this._send({ type: 'load' }); }
  remove() { return this._send({ type: 'remove' }); }

  // Divide el texto en 'parts' tercios por párrafos; si un tercio es muy largo, toma su centro.
  static split(paragraphs, parts = 3) {
    const total = paragraphs.reduce((n, p) => n + p.length, 0);
    if (total < 1500) parts = 1;
    else if (total < 4000) parts = Math.min(parts, 2);
    const out = [];
    let i = 0;
    for (let k = 0; k < parts; k++) {
      const goal = (total / parts) * (k + 1);
      let acc = paragraphs.slice(0, i).reduce((n, p) => n + p.length, 0);
      const chunk = [];
      while (i < paragraphs.length && (acc < goal || k === parts - 1)) {
        chunk.push(paragraphs[i]);
        acc += paragraphs[i++].length;
      }
      let text = chunk.join('\n');
      if (text.length > PART_CHARS) {
        const mid = Math.floor(text.length / 2 - PART_CHARS / 2);
        text = text.slice(mid, mid + PART_CHARS);
      }
      if (text.trim()) out.push(text);
    }
    return out;
  }

  summarize(paragraphs, { lang, bookTitle, chapterName, sentences = 3 }) {
    return this._send({ type: 'summarize', parts: LocalAi.split(paragraphs, sentences), lang, bookTitle, chapterName });
  }
}

export const localAi = new LocalAi();
