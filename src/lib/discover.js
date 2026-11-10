// "Descubrir": recomendaciones de libros parecidos usando los temas de Open Library (gratis, sin claves).
const OL = 'https://openlibrary.org';

// Temas demasiado generales que no sirven para comparar.
const GENERIC = /^(fiction|ficci[oó]n|novela|novels?|literature|literatura|english fiction|american fiction|open library staff picks|history and criticism|translations?.*|accessible book|protected daisy|in library|lending library|large type books|juvenile (fiction|literature)|young adult fiction|reading level.*|nyt:.*|new york times.*|long now.*|award:.*|series:.*|general|literary|classics?|fiction, general|textbooks|readers|spanish language materials|english language|spanish language books|social conditions|condiciones sociales|hope|fear|evil|love|death|friendship|good and evil|amor|muerte|miedo|esperanza|man-woman relationships|families|family|humor|humorous stories)$/i;

function cleanSubjects(list = []) {
  const seen = new Set();
  const out = [];
  for (const s of list) {
    const k = s.trim().toLowerCase();
    if (!k || k.length > 60 || GENERIC.test(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(s.trim());
  }
  return out;
}

async function olSearch(params) {
  const q = new URLSearchParams(params);
  const r = await fetch(`${OL}/search.json?${q}`);
  if (!r.ok) throw new Error('Open Library ' + r.status);
  return (await r.json()).docs || [];
}

// Busca el libro "semilla" y devuelve sus temas.
export async function findSeed(title, author = '') {
  const docs = await olSearch({
    q: [title, author].filter(Boolean).join(' '),
    fields: 'key,title,author_name,subject,first_publish_year,cover_i',
    limit: '8',
  });
  const best = docs.find((d) => (d.subject || []).length > 3) || docs[0];
  if (!best) return null;
  return { key: best.key, title: best.title, author: best.author_name?.[0] || '', subjects: cleanSubjects(best.subject).slice(0, 8) };
}

const norm = (s = '') => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export async function recommend(title, author = '', { exclude = [] } = {}) {
  const cacheKey = 'oilo-disc3:' + norm(title + ' ' + author);
  try {
    const hit = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (hit && Date.now() - hit.at < 7 * 86400000) return hit.data;
  } catch {}

  const seed = await findSeed(title, author);
  if (!seed || !seed.subjects.length) return { seed, items: [] };
  const seedSet = new Set(seed.subjects.map((s) => s.toLowerCase()));
  const excluded = new Set([norm(seed.title), ...exclude.map(norm)]);

  const pools = await Promise.allSettled(
    seed.subjects.slice(0, 6).map((s) =>
      olSearch({ q: `subject:"${s}"`, fields: 'key,title,author_name,subject,first_publish_year,cover_i,ebook_access,language,readinglog_count,ratings_count', limit: '30', sort: 'readinglog' })
    )
  );
  const byKey = new Map();
  for (const p of pools) {
    if (p.status !== 'fulfilled') continue;
    for (const d of p.value) {
      if (!d.title || d.key === seed.key || excluded.has(norm(d.title))) continue;
      // Solo libros con edición en castellano o inglés.
      if (d.language && !d.language.some((l) => l === 'spa' || l === 'eng')) continue;
      const shared = [...new Set((d.subject || []).map((s) => s.toLowerCase()).filter((s) => seedSet.has(s)))];
      if (!shared.length) continue;
      const tkey = norm(d.title.replace(/\(.*?\)/g, ''));
      if (excluded.has(tkey)) continue;
      d._tkey = tkey;
      d._pop = Math.log10(1 + (d.readinglog_count || 0) + 3 * (d.ratings_count || 0));
      const prev = byKey.get(d._tkey);
      if (!prev || prev.shared.length < shared.length) byKey.set(d._tkey, { d, shared });
    }
  }
  const perAuthor = {};
  let pool = [...byKey.values()];
  const strong = pool.filter((x) => x.shared.length >= 2);
  if (strong.length >= 6) pool = strong;
  const items = pool
    // Puntaje: temas en común + popularidad (cuánta gente lo leyó) + que tenga tapa.
    .map((x) => ({ ...x, score: x.shared.length * 1.4 + x.d._pop + (x.d.cover_i ? 0.5 : 0) }))
    .sort((a, b) => b.score - a.score)
    .filter(({ d }) => {
      const a = d.author_name?.[0] || '?';
      perAuthor[a] = (perAuthor[a] || 0) + 1;
      return perAuthor[a] <= 2; // no más de 2 por autor, para variar
    })
    .slice(0, 14)
    .map(({ d, shared }) => ({
      key: d.key,
      title: d.title,
      author: d.author_name?.[0] || '',
      year: d.first_publish_year || null,
      cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
      reason: shared.slice(0, 2).map((s) => s.charAt(0).toUpperCase() + s.slice(1)),
      free: d.ebook_access === 'public',
      url: `${OL}${d.key}`,
    }));
  const data = { seed, items };
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data }));
  } catch {}
  return data;
}
