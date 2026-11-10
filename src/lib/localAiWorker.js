// IA chiquita que corre dentro del celular (sin clave, sin cuenta, sin internet una vez bajada).
// Modelo: Qwen2.5-0.5B-Instruct (Apache 2.0), versión ONNX de onnx-community, vía transformers.js.
import { pipeline, env } from '@huggingface/transformers';

const MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct';
env.allowLocalModels = false;
env.useBrowserCache = true;

let gen = null;
let loading = null;
let chain = Promise.resolve();

async function pickDevice() {
  try {
    if (self.navigator?.gpu && (await navigator.gpu.requestAdapter())) return { device: 'webgpu', dtype: 'q4f16' };
  } catch {}
  return { device: 'wasm', dtype: 'q8' };
}

function modelFile(dtype) {
  const suffix = dtype === 'q4f16' ? '_q4f16' : '_quantized';
  return `https://huggingface.co/${MODEL}/resolve/main/onnx/model${suffix}.onnx`;
}

async function isDownloaded() {
  const { dtype } = await pickDevice();
  try {
    const cache = await caches.open('transformers-cache');
    return !!(await cache.match(modelFile(dtype)));
  } catch {
    return false;
  }
}

async function load() {
  if (gen) return gen;
  if (!loading) {
    loading = (async () => {
      const { device, dtype } = await pickDevice();
      const files = {};
      gen = await pipeline('text-generation', MODEL, {
        device,
        dtype,
        progress_callback: (p) => {
          if (p.status !== 'progress' || !p.total) return;
          files[p.file] = { loaded: p.loaded, total: p.total };
          const all = Object.values(files);
          const loaded = all.reduce((n, f) => n + f.loaded, 0);
          const total = all.reduce((n, f) => n + f.total, 0);
          self.postMessage({ type: 'download', loaded: total ? loaded / total : 0 });
        },
      });
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
    caches.delete('transformers-cache').then(() => {
      gen = null;
      loading = null;
      self.postMessage({ type: 'result', id: m.id, value: true });
    });
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
