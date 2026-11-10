// Resúmenes con IA usando Gemini (Google), con la clave gratuita del propio usuario.
// La clave queda guardada solo en el dispositivo y se manda únicamente a Google (en un encabezado, no en la URL).
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
// Probamos de la más liviana a la más completa; si un modelo no existe para esa clave, pasamos al siguiente.
const MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];
const MAX_CHARS = 60000;

let workingModel = null;

export class AiError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code; // 'key' | 'quota' | 'network' | 'other'
  }
}

async function call(key, model, prompt) {
  let res;
  try {
    res = await fetch(`${API}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 200 },
      }),
    });
  } catch {
    throw new AiError('network');
  }
  if (res.status === 404) return null; // modelo no disponible: probar otro
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    const body = await res.text().catch(() => '');
    if (/API key|API_KEY|permission|PERMISSION/i.test(body) || res.status !== 400) throw new AiError('key', body.slice(0, 200));
    throw new AiError('other', body.slice(0, 200));
  }
  if (res.status === 429) throw new AiError('quota');
  if (!res.ok) throw new AiError('other', `HTTP ${res.status}`);
  const j = await res.json();
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
  if (!text) throw new AiError('other', 'Respuesta vacía');
  return text;
}

async function generate(key, prompt) {
  const order = workingModel ? [workingModel, ...MODELS.filter((m) => m !== workingModel)] : MODELS;
  for (const m of order) {
    const out = await call(key, m, prompt);
    if (out !== null) {
      workingModel = m;
      return out;
    }
  }
  throw new AiError('other', 'Ningún modelo de Gemini disponible para esta clave');
}

const clean = (s) => s.replace(/^["“«\s]+|["”»\s]+$/g, '').replace(/\s+/g, ' ').trim();

// Resumen corto de un capítulo (o de lo leído hasta ahora en él).
export async function summarizeChapter(key, { text, lang, bookTitle, chapterName, partial }) {
  const body = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
  const prompt =
    lang === 'en'
      ? `You help a listener remember an audiobook. Book: "${bookTitle}". ${chapterName}${partial ? ' (only the part already heard)' : ''}.
Summarize what happens in at most 2 short sentences (max 35 words), in English, plain and concrete (who does what). Do not invent anything that is not in the text and do not mention later events. Reply with the summary only.

TEXT:
${body}`
      : `Ayudás a alguien a recordar un audiolibro. Libro: "${bookTitle}". ${chapterName}${partial ? ' (solo la parte ya escuchada)' : ''}.
Resumí qué pasa en como máximo 2 oraciones cortas (máx. 35 palabras), en castellano rioplatense neutro, concreto (quién hace qué). No inventes nada que no esté en el texto ni adelantes lo que viene después. Respondé solo con el resumen.

TEXTO:
${body}`;
  return clean(await generate(key, prompt));
}

// Prueba rápida de la clave.
export async function testKey(key) {
  const out = await generate(key, 'Respondé solamente con la palabra: listo');
  return { ok: true, model: workingModel, reply: out };
}
