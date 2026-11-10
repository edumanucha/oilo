// IA chiquita que corre dentro del celular (sin clave, sin cuenta, sin internet una vez bajada).
// Modelo: Gemma 3 1B (Google, términos de uso de Gemma), versión ONNX de onnx-community, vía transformers.js.
import { pipeline, env } from '@huggingface/transformers';

const MODEL = 'onnx-community/gemma-3-1b-it-ONNX';
env.allowLocalModels = false;

// Guardamos los archivos del modelo en el "sistema de archivos privado" del navegador (OPFS):
// a diferencia de la caché común, acepta archivos enormes escribiéndolos de a pedazos.
const DIR = 'oilo-ai';
const fname = (key) => String(key).replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]+/g, '_');
async function dir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create: true });
}
const opfsCache = {
  async match(key) {
    try {
      const fh = await (await dir()).getFileHandle(fname(key));
      const file = await fh.getFile();
      if (!file.size) return undefined;
      return new Response(file, { headers: { 'content-length': String(file.size) } });
    } catch {
      return undefined;
    }
  },
  async put(key, response) {
    const fh = await (await dir()).getFileHandle(fname(key), { create: true });
    const w = await fh.createWritable();
    await response.body.pipeTo(w);
  },
};
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = opfsCache;

let gen = null;
let loading = null;
let chain = Promise.resolve();

async function pickDevice() {
  try {
    if (self.navigator?.gpu && (await navigator.gpu.requestAdapter())) return { device: 'webgpu', dtype: 'q4f16' };
  } catch {}
  return { device: 'wasm', dtype: 'q4' };
}

function modelFile(dtype) {
  return `https://huggingface.co/${MODEL}/resolve/main/onnx/model_${dtype}.onnx_data`;
}

async function isDownloaded() {
  const { dtype } = await pickDevice();
  const r = await opfsCache.match(modelFile(dtype));
  return !!r && Number(r.headers.get('content-length')) > 100e6;
}

// Bajamos nosotros los archivos (con progreso) y los dejamos en el almacén OPFS con la misma clave
// que usa la librería: así los encuentra y funciona sin internet.
const FILES = (dtype) => [
  'config.json',
  'generation_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  `onnx/model_${dtype}.onnx`,
  `onnx/model_${dtype}.onnx_data`,
];
const SIZES = { 'onnx_data': 763e6 };

async function predownload(dtype, report) {
  const urls = FILES(dtype).map((p) => `https://huggingface.co/${MODEL}/resolve/main/${p}`);
  const total = urls.reduce((n, u) => n + (u.endsWith('onnx_data') ? SIZES.onnx_data : 2e6), 0);
  let done = 0;
  for (const url of urls) {
    const est = url.endsWith('onnx_data') ? SIZES.onnx_data : 2e6;
    if (await opfsCache.match(url)) {
      done += est;
      report(done / total);
      continue;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    // Se escribe al disco a medida que llega (no se guarda todo en memoria).
    const fh = await (await dir()).getFileHandle(fname(url) + '.part', { create: true });
    const w = await fh.createWritable();
    let got = 0;
    const counter = new TransformStream({
      transform(chunk, ctrl) {
        got += chunk.length;
        report(Math.min(1, (done + Math.min(got, est)) / total));
        ctrl.enqueue(chunk);
      },
    });
    await res.body.pipeThrough(counter).pipeTo(w);
    // Recién cuando terminó entero lo renombramos: así nunca queda un archivo a medias.
    await fh.move(fname(url));
    done += est;
  }
  report(1);
}

async function load() {
  if (gen) return gen;
  if (!loading) {
    loading = (async () => {
      const { device, dtype } = await pickDevice();
      await predownload(dtype, (f) => self.postMessage({ type: 'download', loaded: f }));
      gen = await pipeline('text-generation', MODEL, { device, dtype });
      self.postMessage({ type: 'engine', device });
      return gen;
    })().catch((e) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

// Limpia lo que devuelve el modelo: saca introducciones ("Resumen:", "En este texto…") y deja la primera frase útil.
function firstSentence(text) {
  let t = text.replace(/\s+/g, ' ').trim();
  t = t.replace(/^(resumen|summary|respuesta|answer)\s*[:\-–]\s*/i, '');
  t = t.replace(/^(en (este|el) (texto|fragmento)[^,:]*[,:]\s*|in this (text|passage)[^,:]*[,:]\s*)/i, '');
  t = t.replace(/^["“«'\s-]+|["”»'\s]+$/g, '');
  const sentences = t.match(/[^.!?]+[.!?]?/g) || [t];
  const good = sentences.map((s) => s.trim()).find((s) => s.split(' ').length >= 5) || sentences[0] || '';
  return good.charAt(0).toUpperCase() + good.slice(1);
}

// Ejemplo inventado que le muestra al modelo el formato de respuesta esperado.
const EXAMPLE = {
  es: {
    text: 'Ana buscó la llave por toda la casa. Al final la encontró en el bolsillo del abrigo y salió corriendo a la estación, porque el tren estaba por salir.',
    answer: 'Ana encuentra la llave en su abrigo y corre a la estación para no perder el tren.',
    ask: '¿Qué pasa en este texto? Contalo en pocas palabras.',
    system: 'Respondés en castellano, con una frase corta y concreta que cuenta qué pasa (quién hace qué). Sin introducciones ni explicaciones. Nunca inventes.',
  },
  en: {
    text: 'Ana searched the whole house for the key. She finally found it in her coat pocket and ran to the station, because the train was about to leave.',
    answer: 'Ana finds the key in her coat and runs to the station to catch the train.',
    ask: 'What happens in this text? Tell it in a few words.',
    system: 'You answer in English with one short, concrete sentence saying what happens (who does what). No introductions or explanations. Never invent.',
  },
};

async function oneSentence(fragment, { lang }) {
  const ex = EXAMPLE[lang === 'en' ? 'en' : 'es'];
  const messages = [
    { role: 'system', content: ex.system },
    { role: 'user', content: `${ex.text}\n\n${ex.ask}` },
    { role: 'assistant', content: ex.answer },
    { role: 'user', content: `${fragment}\n\n${ex.ask}` },
  ];
  const out = await gen(messages, { max_new_tokens: 60, do_sample: false, repetition_penalty: 1.15 });
  const last = out[0].generated_text.at(-1);
  return firstSentence(typeof last === 'string' ? last : last.content || '');
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'status') {
    isDownloaded().then((ok) => self.postMessage({ type: 'result', id: m.id, value: ok }));
    return;
  }
  if (m.type === 'remove') {
    (async () => {
      try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(DIR, { recursive: true });
      } catch {}
      await caches.delete('transformers-cache').catch(() => {}); // restos de versiones anteriores
      gen = null;
      loading = null;
      self.postMessage({ type: 'result', id: m.id, value: true });
    })();
    return;
  }
  chain = chain.then(async () => {
    try {
      await load();
      if (m.type === 'load') return self.postMessage({ type: 'result', id: m.id, value: true });
      // m.type === 'summarize': una oración por cada fragmento recibido.
      const sentences = [];
      for (const f of m.parts) {
        const s = await oneSentence(f, m);
        if (s) sentences.push(s);
      }
      self.postMessage({ type: 'result', id: m.id, value: sentences.join(' ') });
    } catch (err) {
      self.postMessage({ type: 'error', id: m.id, message: String(err?.message || err) });
    }
  });
};
