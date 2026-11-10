// Utilidades de texto: limpieza, frases, idioma y resumen.

const ES_WORDS = ['que', 'de', 'la', 'el', 'en', 'y', 'los', 'se', 'del', 'las', 'un', 'por', 'con', 'no', 'una', 'su', 'para', 'es', 'al', 'lo', 'como', 'más', 'pero', 'sus', 'le', 'ya', 'o', 'fue', 'este', 'ha', 'sí', 'porque', 'esta', 'entre', 'cuando', 'muy', 'sin', 'sobre', 'también', 'me', 'hasta', 'hay', 'donde', 'quien', 'desde', 'todo', 'nos', 'durante', 'todos', 'uno', 'les', 'ni', 'contra', 'otros', 'ese', 'eso', 'ante', 'ellos', 'e', 'esto', 'mí', 'antes', 'algunos', 'qué', 'unos', 'yo', 'otro', 'otras', 'otra', 'él', 'tanto', 'esa', 'estos', 'mucho', 'quienes', 'nada', 'muchos', 'cual', 'poco', 'ella', 'estar', 'estas', 'algunas', 'algo', 'nosotros', 'mi', 'mis', 'tú', 'te', 'ti', 'tu', 'tus', 'era', 'había', 'son', 'ser', 'tiene', 'dijo', 'vez', 'así', 'aunque', 'luego', 'entonces', 'pues', 'cada', 'han', 'sido', 'está', 'estaba'];
const EN_WORDS = ['the', 'of', 'and', 'to', 'a', 'in', 'is', 'it', 'you', 'that', 'he', 'was', 'for', 'on', 'are', 'with', 'as', 'i', 'his', 'they', 'be', 'at', 'one', 'have', 'this', 'from', 'or', 'had', 'by', 'not', 'but', 'what', 'some', 'we', 'can', 'out', 'other', 'were', 'all', 'there', 'when', 'up', 'use', 'your', 'how', 'said', 'an', 'each', 'she', 'which', 'do', 'their', 'if', 'will', 'way', 'about', 'many', 'then', 'them', 'would', 'so', 'these', 'her', 'him', 'into', 'has', 'more', 'could', 'no', 'my', 'than', 'been', 'who', 'its', 'now', 'did', 'just', 'over', 'also', 'after', 'only', 'very', 'me', 'our', 'any', 'those', 'being', 'where', 'while', 'should', 'us', 'because', 'again'];
const STOP = { es: new Set(ES_WORDS), en: new Set(EN_WORDS) };

export function detectLang(text) {
  const words = text.toLowerCase().slice(0, 20000).match(/[a-záéíóúñü]+/g) || [];
  let es = 0, en = 0;
  for (const w of words) {
    if (STOP.es.has(w)) es++;
    if (STOP.en.has(w)) en++;
  }
  return en > es * 1.1 ? 'en' : 'es';
}

export function normalizeLang(code) {
  if (!code) return null;
  const c = code.toLowerCase();
  if (c.startsWith('es')) return 'es';
  if (c.startsWith('en')) return 'en';
  return null;
}

export function cleanParagraph(s) {
  return s
    .replace(/­/g, '') // guiones suaves
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Une líneas de un párrafo quitando guiones de corte de palabra ("pala-\nbra").
export function joinLines(lines) {
  let out = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!out) out = line;
    else if (/[a-záéíóúñü]-$/i.test(out) && /^[a-záéíóúñü]/.test(line)) out = out.slice(0, -1) + line;
    else out += ' ' + line;
  }
  return cleanParagraph(out);
}

const segmenters = {};
function segmenter(lang) {
  if (typeof Intl === 'undefined' || !Intl.Segmenter) return null;
  if (!segmenters[lang]) segmenters[lang] = new Intl.Segmenter(lang, { granularity: 'sentence' });
  return segmenters[lang];
}

const MAX_SENTENCE = 260;

// Divide frases muy largas por comas / punto y coma para que la voz no se trabe.
function splitLong(sentence) {
  if (sentence.length <= MAX_SENTENCE) return [sentence];
  const parts = sentence.split(/(?<=[;:,—])\s+/);
  const out = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + ' ' + p).trim().length > MAX_SENTENCE && cur) {
      out.push(cur.trim());
      cur = p;
    } else cur = (cur + ' ' + p).trim();
  }
  if (cur) out.push(cur.trim());
  // Si aún quedan trozos gigantes (sin comas), cortamos por palabras.
  return out.flatMap((s) => {
    if (s.length <= MAX_SENTENCE * 1.5) return [s];
    const words = s.split(' ');
    const chunks = [];
    let c = '';
    for (const w of words) {
      if ((c + ' ' + w).length > MAX_SENTENCE && c) {
        chunks.push(c);
        c = w;
      } else c = c ? c + ' ' + w : w;
    }
    if (c) chunks.push(c);
    return chunks;
  });
}

const sentenceCache = new Map();
export function splitSentences(paragraph, lang = 'es') {
  const key = lang + '|' + paragraph;
  const hit = sentenceCache.get(key);
  if (hit) return hit;
  let sentences;
  const seg = segmenter(lang);
  if (seg) sentences = Array.from(seg.segment(paragraph), (s) => s.segment.trim());
  else sentences = paragraph.match(/[^.!?…]+[.!?…]+["»”')\]]*\s*|[^.!?…]+$/g)?.map((s) => s.trim()) || [paragraph];
  sentences = sentences.filter((s) => /[\p{L}\p{N}]/u.test(s)).flatMap(splitLong);
  if (!sentences.length) sentences = [paragraph];
  if (sentenceCache.size > 3000) sentenceCache.clear();
  sentenceCache.set(key, sentences);
  return sentences;
}

// Resumen "extractivo": elige las frases más importantes del texto (sin IA, sin internet).
export function summarize(paragraphs, lang = 'es', maxSentences = 6) {
  return summarizeWithPos(paragraphs, lang, maxSentences).map((x) => x.s);
}

// Igual que summarize, pero cada frase recuerda de dónde salió ({ s, p: párrafo, si: frase })
// para poder saltar a esa parte del libro.
export function summarizeWithPos(paragraphs, lang = 'es', maxSentences = 6, base = 0) {
  const all = [];
  paragraphs.forEach((p, pi) => splitSentences(p, lang).forEach((s, si) => all.push({ s, p: base + pi, si })));
  const cand = all.filter((x) => x.s.length > 40 && x.s.length < 320);
  if (cand.length <= maxSentences) return cand;
  const candidates = cand.map((x) => x.s);

  const stop = STOP[lang] || STOP.es;
  const tokenize = (s) => (s.toLowerCase().match(/[\p{L}]{3,}/gu) || []).filter((w) => !stop.has(w));
  const freq = new Map();
  candidates.forEach((s) => new Set(tokenize(s)).forEach((w) => freq.set(w, (freq.get(w) || 0) + 1)));
  // Palabras que aparecen en casi todas las frases no aportan.
  const maxDf = candidates.length * 0.5;

  const scored = candidates.map((s, i) => {
    const toks = tokenize(s);
    if (!toks.length) return { s, i, score: 0 };
    let score = 0;
    for (const w of toks) {
      const f = freq.get(w) || 0;
      if (f > 1 && f < maxDf) score += Math.log(1 + f);
      // Nombres propios (personajes, lugares) suelen ser clave.
      if (/^\p{Lu}/u.test(w)) score += 0.5;
    }
    const caps = (s.match(/\s\p{Lu}\p{Ll}+/gu) || []).length;
    score = score / Math.sqrt(toks.length) + caps * 0.3;
    // Leve preferencia por lo más reciente.
    score *= 1 + (i / candidates.length) * 0.35;
    return { s, i, score };
  });

  const chosen = [];
  for (const c of scored.sort((a, b) => b.score - a.score)) {
    if (chosen.length >= maxSentences) break;
    const toks = new Set(tokenize(c.s));
    const tooSimilar = chosen.some((o) => {
      const ot = tokenize(o.s);
      const shared = ot.filter((w) => toks.has(w)).length;
      return shared / Math.max(1, Math.min(ot.length, toks.size)) > 0.6;
    });
    if (!tooSimilar) chosen.push(c);
  }
  return chosen.sort((a, b) => a.i - b.i).map((c) => cand[c.i]);
}

export function formatDuration(ms, t) {
  const min = Math.round(ms / 60000);
  if (min < 60) return t('minutes', { n: Math.max(1, min) });
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? t('hoursMinutes', { h, m }) : t('hours', { h });
}

// Estimación: ~ 900 caracteres por minuto a velocidad 1x.
export const CHARS_PER_MINUTE = 900;
