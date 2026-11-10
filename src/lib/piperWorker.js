// Corre la voz neuronal en un hilo aparte para que la app no se trabe.
import { TtsSession } from '@mintplex-labs/piper-tts-web';

// El motor de voz viene dentro de la app (carpetas /ort y /piper): leer no necesita internet.
let WASM = null;
function wasmPaths(base) {
  return {
    onnxWasm: undefined, // usa el motor que empaqueta la app (sin duplicados)
    piperData: new URL('piper/piper_phonemize.data', base).href,
    piperWasm: new URL('piper/piper_phonemize.wasm', base).href,
  };
}

let session = null;
let currentVoice = null;
let chain = Promise.resolve();

async function getSession(voiceId) {
  if (session && currentVoice === voiceId) return session;
  TtsSession._instance = null; // la librería reutiliza la sesión aunque cambie la voz
  currentVoice = voiceId;
  session = await TtsSession.create({
    voiceId,
    wasmPaths: WASM,
    progress: (p) => {
      if (p.url && !p.url.startsWith('tts://')) self.postMessage({ type: 'download', voiceId, loaded: p.loaded, total: p.total });
    },
  });
  return session;
}

self.onmessage = (e) => {
  const { id, voiceId, text, base } = e.data;
  if (!WASM && base) WASM = wasmPaths(base);
  chain = chain.then(async () => {
    try {
      const s = await getSession(voiceId);
      const blob = await s.predict(text);
      self.postMessage({ type: 'result', id, blob });
    } catch (err) {
      session = null;
      currentVoice = null;
      self.postMessage({ type: 'error', id, message: String(err?.message || err) });
    }
  });
};
