// Voz "Supertonic 3": muy natural, corre 100% en el celular (sin internet una vez descargada).
// Basado en el ejemplo web oficial de Supertonic (MIT). Modelo: Supertone/supertonic-3 (OpenRAIL-M),
// Por defecto usa el modelo completo (igual a la demo oficial, ~400 MB): la versión comprimida suena mal.
import * as ort from 'onnxruntime-web/webgpu';

const HF = 'https://huggingface.co';
const INT8 = `${HF}/csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11/resolve/main`;
const OFFICIAL = `${HF}/Supertone/supertonic-3/resolve/main`;
const FP = `${OFFICIAL}/onnx`;
const VARIANTS = {
  full: { dp: `${FP}/duration_predictor.onnx`, enc: `${FP}/text_encoder.onnx`, vec: `${FP}/vector_estimator.onnx`, voc: `${FP}/vocoder.onnx` },
  lite: { dp: `${INT8}/duration_predictor.int8.onnx`, enc: `${INT8}/text_encoder.int8.onnx`, vec: `${INT8}/vector_estimator.int8.onnx`, voc: `${INT8}/vocoder.int8.onnx` },
};
function filesFor(v) {
  const V = VARIANTS[v] || VARIANTS.full;
  const big = (u, fp, q) => (u.includes('int8') ? q : fp);
  return [
    { key: 'dp', url: V.dp, size: 3.7e6 },
    { key: 'enc', url: V.enc, size: 36.4e6 },
    { key: 'vec', url: V.vec, size: big(V.vec, 256.5e6, 78.4e6) },
    { key: 'voc', url: V.voc, size: big(V.voc, 101.4e6, 26e6) },
    { key: 'cfg', url: `${FP}/tts.json`, size: 8e3 },
    { key: 'idx', url: `${FP}/unicode_indexer.json`, size: 2.8e5 },
  ];
}
const styleUrl = (id) => `${OFFICIAL}/voice_styles/${id}.json`;
const CACHE = 'oilo-supertonic-v1';

let tts = null; // { cfg, indexer, dp, enc, vec, voc }
let loading = null;
let ttsVariant = null;
const styles = new Map();
let chain = Promise.resolve();

async function cachedFetch(url, onBytes) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(url);
  if (hit) {
    onBytes?.(Number(hit.headers.get('x-size')) || 0, true);
    return hit;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onBytes?.(got, false);
  }
  const blob = new Blob(parts);
  await cache.put(url, new Response(blob, { headers: { 'x-size': String(blob.size) } }));
  return new Response(blob);
}

async function isDownloaded(variant) {
  const cache = await caches.open(CACHE);
  for (const f of filesFor(variant)) if (!(await cache.match(f.url))) return false;
  return true;
}

async function download(variant, report) {
  const FILES = filesFor(variant);
  const TOTAL = FILES.reduce((n, f) => n + f.size, 0);
  const done = {};
  const tick = () => report(Math.min(1, Object.values(done).reduce((a, b) => a + b, 0) / TOTAL));
  const out = {};
  for (const f of FILES) {
    const res = await cachedFetch(f.url, (bytes, fromCache) => {
      done[f.key] = fromCache ? f.size : bytes;
      tick();
    });
    out[f.key] = f.key === 'cfg' || f.key === 'idx' ? await res.json() : await res.arrayBuffer();
  }
  return out;
}

async function load(base, report, variant = 'full') {
  if (tts && ttsVariant === variant) return tts;
  if (ttsVariant !== variant) { tts = null; loading = null; }
  ttsVariant = variant;
  if (!loading) {
    loading = (async () => {
      ort.env.wasm.numThreads = 1;
      const files = await download(variant, report);
      // Placa de video (WebGPU) si el equipo la tiene: mucho más rápida. Si no, procesador (wasm).
      let ep = 'wasm';
      try { if (self.navigator?.gpu && (await navigator.gpu.requestAdapter())) ep = 'webgpu'; } catch {}
      const make = async (buf) => {
        if (ep === 'webgpu') {
          try { return await ort.InferenceSession.create(buf, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' }); }
          catch (err) { console.warn('WebGPU falló, uso wasm', err); ep = 'wasm'; }
        }
        return ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      };
      const dp = await make(files.dp);
      const enc = await make(files.enc);
      const vec = await make(files.vec);
      const voc = await make(files.voc);
      self.postMessage({ type: 'engine', ep });
      tts = { cfg: files.cfg, indexer: files.idx, dp, enc, vec, voc };
      return tts;
    })().catch((e) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

async function getStyle(id) {
  if (styles.has(id)) return styles.get(id);
  const res = await cachedFetch(styleUrl(id));
  const j = await res.json();
  const ttl = new ort.Tensor('float32', Float32Array.from(j.style_ttl.data.flat(Infinity)), j.style_ttl.dims);
  const dp = new ort.Tensor('float32', Float32Array.from(j.style_dp.data.flat(Infinity)), j.style_dp.dims);
  const st = { ttl, dp };
  styles.set(id, st);
  return st;
}

/* ---------- texto ---------- */
const REPL = { '–': '-', '‑': '-', '—': '-', _: ' ', '“': '"', '”': '"', '‘': "'", '’': "'", '´': "'", '`': "'", '[': ' ', ']': ' ', '|': ' ', '/': ' ', '#': ' ', '→': ' ', '←': ' ', '«': '"', '»': '"' };
function preprocess(text, lang) {
  text = text.normalize('NFKD');
  text = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+/gu, '');
  for (const [k, v] of Object.entries(REPL)) text = text.replaceAll(k, v);
  text = text.replace(/[♥☆♡©\\]/g, '');
  text = text.replace(/ ([,.!?;:'])/g, '$1').replace(/"{2,}/g, '"').replace(/'{2,}/g, "'");
  text = text.replace(/\s+/g, ' ').trim();
  if (!/[.!?;:,'"')\]}…»]$/.test(text)) text += '.';
  return `<${lang}>${text}</${lang}>`;
}

function chunk(text, max = 280) {
  if (text.length <= max) return [text];
  const out = [];
  let cur = '';
  for (const s of text.split(/(?<=[.!?;:,])\s+/)) {
    if ((cur + ' ' + s).trim().length > max && cur) {
      out.push(cur.trim());
      cur = s;
    } else cur = (cur + ' ' + s).trim();
  }
  if (cur) out.push(cur.trim());
  return out;
}

/* ---------- inferencia (una frase) ---------- */
async function inferOne(text, lang, style, steps) {
  const { cfg, indexer, dp, enc, vec, voc } = tts;
  const s = preprocess(text, lang);
  const ids = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    ids.push(cp < indexer.length ? indexer[cp] : -1);
  }
  const L = ids.length;
  const textIds = new ort.Tensor('int64', BigInt64Array.from(ids, (x) => BigInt(x)), [1, L]);
  const textMask = new ort.Tensor('float32', new Float32Array(L).fill(1), [1, 1, L]);

  const T = { start: performance.now() };
  const { duration } = await dp.run({ text_ids: textIds, style_dp: style.dp, text_mask: textMask });
  T.dp = performance.now();
  const dur = duration.data[0] / 1.0;
  const { text_emb } = await enc.run({ text_ids: textIds, style_ttl: style.ttl, text_mask: textMask });
  T.enc = performance.now();

  const sr = cfg.ae.sample_rate;
  const chunkSize = cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor;
  const latentDim = cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor;
  const wavLen = Math.floor(dur * sr);
  const latentLen = Math.max(1, Math.floor((wavLen + chunkSize - 1) / chunkSize));

  let xt = new Float32Array(latentDim * latentLen);
  for (let i = 0; i < xt.length; i++) {
    const u1 = Math.max(1e-4, Math.random());
    xt[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random());
  }
  const latentMask = new ort.Tensor('float32', new Float32Array(latentLen).fill(1), [1, 1, latentLen]);
  const total = new ort.Tensor('float32', new Float32Array([steps]), [1]);
  for (let step = 0; step < steps; step++) {
    const out = await vec.run({
      noisy_latent: new ort.Tensor('float32', xt, [1, latentDim, latentLen]),
      text_emb,
      style_ttl: style.ttl,
      latent_mask: latentMask,
      text_mask: textMask,
      current_step: new ort.Tensor('float32', new Float32Array([step]), [1]),
      total_step: total,
    });
    xt = out.denoised_latent.data;
  }
  T.vec = performance.now();
  const { wav_tts } = await voc.run({ latent: new ort.Tensor('float32', xt, [1, latentDim, latentLen]) });
  T.voc = performance.now();
  self.postMessage({ type: 'timing', dp: T.dp - T.start, enc: T.enc - T.dp, vec: T.vec - T.enc, voc: T.voc - T.vec, steps, chars: text.length, latentLen });
  return { pcm: wav_tts.data.subarray(0, Math.min(wav_tts.data.length, wavLen || wav_tts.data.length)), sr };
}

function toWav(pcm, sr) {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  const out = new Int16Array(buf, 44);
  for (let i = 0; i < pcm.length; i++) out[i] = Math.max(-1, Math.min(1, pcm[i])) * 32767;
  return new Blob([buf], { type: 'audio/wav' });
}

async function synth(text, lang, voice, steps, base, variant) {
  await load(base, (f) => self.postMessage({ type: 'download', loaded: f, total: 1 }), variant);
  const style = await getStyle(voice);
  const parts = chunk(text);
  const pcms = [];
  let sr = 44100;
  for (const p of parts) {
    const r = await inferOne(p, lang, style, steps);
    sr = r.sr;
    pcms.push(r.pcm);
    if (parts.length > 1) pcms.push(new Float32Array(Math.floor(sr * 0.2)));
  }
  const len = pcms.reduce((n, a) => n + a.length, 0);
  const all = new Float32Array(len);
  let o = 0;
  for (const a of pcms) {
    all.set(a, o);
    o += a.length;
  }
  // Para guardar: bajamos a 22 kHz (calidad de voz, ocupa la mitad).
  if (sr >= 44000) {
    const half = new Float32Array(Math.floor(all.length / 2));
    for (let i = 0; i < half.length; i++) half[i] = (all[2 * i] + all[2 * i + 1]) / 2;
    return toWav(half, Math.round(sr / 2));
  }
  return toWav(all, sr);
}

async function voiceList() {
  const cache = await caches.open(CACHE);
  const ids = ['M1', 'M2', 'M3', 'M4', 'M5', 'F1', 'F2', 'F3', 'F4', 'F5'];
  const out = [];
  for (const id of ids) if (await cache.match(styleUrl(id))) out.push(id);
  return out;
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'voices') {
    voiceList().then((list) => self.postMessage({ type: 'status', id: m.id, downloaded: list }));
    return;
  }
  if (m.type === 'removeVoice') {
    caches.open(CACHE).then((c) => c.delete(styleUrl(m.voice))).then(() => { styles.delete(m.voice); self.postMessage({ type: 'status', id: m.id, downloaded: true }); });
    return;
  }
  if (m.type === 'addVoice') {
    cachedFetch(styleUrl(m.voice)).then(() => self.postMessage({ type: 'status', id: m.id, downloaded: true })).catch((err) => self.postMessage({ type: 'error', id: m.id, message: String(err) }));
    return;
  }
  if (m.type === 'status') {
    isDownloaded(m.variant || 'full').then((ok) => self.postMessage({ type: 'status', id: m.id, downloaded: ok }));
    return;
  }
  chain = chain.then(async () => {
    try {
      if (m.type === 'download') {
        await load(m.base, (f) => self.postMessage({ type: 'download', loaded: f, total: 1 }), m.variant || 'full');
        self.postMessage({ type: 'result', id: m.id, ok: true });
      } else {
        const blob = await synth(m.text, m.lang, m.voice, m.steps || 5, m.base, m.variant || 'full');
        self.postMessage({ type: 'result', id: m.id, blob });
      }
    } catch (err) {
      self.postMessage({ type: 'error', id: m.id, message: String(err?.message || err) });
    }
  });
};
