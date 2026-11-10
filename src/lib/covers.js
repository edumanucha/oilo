// Búsqueda de portadas gratis: Open Library + Google Books (sin claves).
export async function searchCovers(title, author = '') {
  const results = [];
  const seen = new Set();
  const add = (url, source, label) => {
    if (url && !seen.has(url)) {
      seen.add(url);
      results.push({ url, source, label });
    }
  };
  const ol = (async () => {
    const q = new URLSearchParams({ title, limit: '15', fields: 'title,author_name,cover_i,first_publish_year' });
    if (author) q.set('author', author);
    const r = await fetch(`https://openlibrary.org/search.json?${q}`);
    const j = await r.json();
    (j.docs || []).forEach((d) => d.cover_i && add(`https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`, 'Open Library', [d.title, d.first_publish_year].filter(Boolean).join(' · ')));
  })();
  const gb = (async () => {
    const q = `intitle:${title}${author ? ` inauthor:${author}` : ''}`;
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=20&printType=books`);
    const j = await r.json();
    (j.items || []).forEach((it) => {
      const l = it.volumeInfo?.imageLinks;
      const u = l?.thumbnail || l?.smallThumbnail;
      if (u) add(u.replace('http://', 'https://').replace('&edge=curl', ''), 'Google Books', [it.volumeInfo.title, it.volumeInfo.publishedDate?.slice(0, 4)].filter(Boolean).join(' · '));
    });
  })();
  await Promise.allSettled([ol, gb]);
  return results;
}

// Intenta guardar la imagen dentro del celular (para que funcione sin internet).
export async function fetchCoverBlob(url) {
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) return null;
    const b = await r.blob();
    return b.type.startsWith('image/') && b.size > 1000 ? b : null;
  } catch {
    return null;
  }
}

// Colores de tela/cartón de tapas viejas: [texto, fondo].
const PALETTE = [
  ['#fbe9d8', '#b65a35'], ['#f1ecd2', '#4f6b2a'], ['#3d2c12', '#e2cfa0'], ['#efe6d2', '#2f4a5f'],
  ['#f6dfcc', '#8d3b2f'], ['#3a2608', '#d9a441'], ['#f3ead8', '#5a4636'], ['#f5e9dc', '#6b3a52'],
];
export function placeholderColors(title = '') {
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
