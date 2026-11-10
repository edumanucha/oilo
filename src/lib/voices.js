// Voces naturales (Piper) gratuitas que se descargan una vez y funcionan sin internet.
export const PIPER_VOICES = [
  { id: 'es_MX-claude-high', lang: 'es', name: 'Claudia', accent: 'México', gender: 'f', mb: 63 },
  { id: 'es_ES-davefx-medium', lang: 'es', name: 'David', accent: 'España', gender: 'm', mb: 63 },
  { id: 'es_MX-ald-medium', lang: 'es', name: 'Aldo', accent: 'México', gender: 'm', mb: 63 },
  { id: 'es_ES-sharvard-medium', lang: 'es', name: 'Sara', accent: 'España', gender: 'f', mb: 77 },
  { id: 'en_US-hfc_female-medium', lang: 'en', name: 'Hannah', accent: 'US', gender: 'f', mb: 63 },
  { id: 'en_US-ryan-high', lang: 'en', name: 'Ryan', accent: 'US', gender: 'm', mb: 116 },
  { id: 'en_US-lessac-medium', lang: 'en', name: 'Lessac', accent: 'US', gender: 'f', mb: 63 },
  { id: 'en_US-hfc_male-medium', lang: 'en', name: 'Henry', accent: 'US', gender: 'm', mb: 63 },
  { id: 'en_GB-alba-medium', lang: 'en', name: 'Alba', accent: 'UK', gender: 'f', mb: 63 },
];

// Supertonic 3: las voces más naturales. Un solo modelo (~145 MB) para todas; cada voz pesa ~0,3 MB.
// Las 10 voces de Supertonic 3: todas hablan castellano e inglés. Cada una pesa ~0,3 MB.
export const SUPERTONIC_VOICES = [
  { id: 'M1', name: 'Alex', gender: 'm', desc: { es: 'clara y con energía', en: 'clear and upbeat' } },
  { id: 'M2', name: 'James', gender: 'm', desc: { es: 'grave y firme', en: 'deep and steady' } },
  { id: 'M3', name: 'Roberto', gender: 'm', desc: { es: 'segura, de locutor', en: 'polished, authoritative' } },
  { id: 'M4', name: 'Sam', gender: 'm', desc: { es: 'suave y juvenil', en: 'soft and youthful' } },
  { id: 'M5', name: 'Daniel', gender: 'm', desc: { es: 'cálida y pausada, ideal para cuentos', en: 'warm, great for stories' } },
  { id: 'F1', name: 'Sara', gender: 'f', desc: { es: 'serena y de tono grave', en: 'calm, slightly low' } },
  { id: 'F2', name: 'Lily', gender: 'f', desc: { es: 'suave y amable', en: 'soft and friendly' } },
  { id: 'F3', name: 'Jessica', gender: 'f', desc: { es: 'clara y profesional', en: 'clear and professional' } },
  { id: 'F4', name: 'Olivia', gender: 'f', desc: { es: 'cálida y expresiva', en: 'warm and expressive' } },
  { id: 'F5', name: 'Emilia', gender: 'f', desc: { es: 'dulce y tranquila', en: 'sweet and calm' } },
];
export const SUPERTONIC_MB = 400;
export const DEFAULT_ST_VOICE = { es: 'M5', en: 'M1' };

export const DEFAULT_VOICE = { es: 'es_MX-claude-high', en: 'en_US-hfc_female-medium' };

export function systemVoices(lang) {
  if (typeof speechSynthesis === 'undefined') return [];
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang?.toLowerCase().startsWith(lang))
    .sort((a, b) => score(b) - score(a));
}

// Prioriza voces "naturales/neural/premium/enhanced" y argentinas para español.
function score(v) {
  let s = 0;
  if (/natural|neural|premium|enhanced|mejorad/i.test(v.name)) s += 10;
  if (/google/i.test(v.name)) s += 4;
  if (/es-(AR|419|US|MX)/i.test(v.lang)) s += 2;
  if (v.localService) s += 1;
  return s;
}

export function waitForSystemVoices() {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === 'undefined') return resolve([]);
    const v = speechSynthesis.getVoices();
    if (v.length) return resolve(v);
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}
