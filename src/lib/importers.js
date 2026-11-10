// Convierte EPUB / PDF / DOCX / TXT en { title, author, lang, cover, paras[], chapters[] }.
// chapters: [{ title, start, end }] con índices de párrafo (end exclusivo).
import { cleanParagraph, joinLines, detectLang, normalizeLang } from './text.js';

const BLOCK_SEL = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,dd,dt,figcaption,td,th';
const PARAS_PER_PART = 40;

export async function importFile(file, onProgress = () => {}) {
  const name = file.name.toLowerCase();
  let result;
  if (name.endsWith('.epub')) result = await importEpub(file, onProgress);
  else if (name.endsWith('.pdf')) result = await importPdf(file, onProgress);
  else if (name.endsWith('.docx')) result = await importDocx(file, onProgress);
  else if (name.endsWith('.txt') || name.endsWith('.md')) result = await importTxt(file, onProgress);
  else throw new Error('unsupported');

  const paras = result.paras.filter(Boolean);
  if (!paras.length) throw new Error('empty');
  const fallbackTitle = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return {
    title: (result.title || '').trim() || fallbackTitle,
    author: (result.author || '').trim(),
    lang: normalizeLang(result.lang) || detectLang(paras.slice(0, 200).join(' ')),
    cover: result.cover || null,
    format: name.split('.').pop(),
    paras,
    chapters: fixChapters(result.chapters, paras.length),
  };
}

function fixChapters(chapters, total) {
  let list = (chapters || []).filter((c) => c.end > c.start).sort((a, b) => a.start - b.start);
  if (!list.length) list = [{ title: '', start: 0, end: total }];
  // Que no queden huecos ni solapamientos.
  list[0].start = 0;
  for (let i = 0; i < list.length - 1; i++) list[i].end = list[i + 1].start;
  list[list.length - 1].end = total;
  return list.filter((c) => c.end > c.start);
}

// Bloques de texto de un documento HTML, sin duplicar anidados (li > p).
function extractBlocks(doc) {
  const root = doc.body || doc.documentElement;
  if (!root) return [];
  root.querySelectorAll('script,style,nav[epub\\:type="toc"],rt').forEach((n) => n.remove());
  const blocks = [];
  const all = root.querySelectorAll(BLOCK_SEL);
  if (all.length) {
    all.forEach((el) => {
      if (el.querySelector(BLOCK_SEL)) return;
      const text = cleanParagraph(el.textContent || '');
      if (text) blocks.push({ text, heading: /^H[1-6]$/.test(el.tagName.toUpperCase()) ? el.tagName.toUpperCase() : null });
    });
  }
  if (!blocks.length) {
    (root.textContent || '').split(/\n\s*\n/).forEach((t) => {
      const text = cleanParagraph(t);
      if (text) blocks.push({ text, heading: null });
    });
  }
  return blocks;
}

function chunkChapters(total, label = '') {
  const chapters = [];
  for (let i = 0; i < total; i += PARAS_PER_PART) chapters.push({ title: label, start: i, end: Math.min(total, i + PARAS_PER_PART) });
  return chapters;
}

/* ---------------- EPUB ---------------- */
async function importEpub(file, onProgress) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(file);
  const readText = async (path) => {
    const f = zip.file(path) || zip.file(decodeURIComponent(path));
    return f ? f.async('string') : null;
  };
  const parser = new DOMParser();
  const container = parser.parseFromString(await readText('META-INF/container.xml'), 'application/xml');
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opf = parser.parseFromString(await readText(opfPath), 'application/xml');
  const resolve = (base, href) => {
    const parts = (base + href.split('#')[0]).split('/');
    const out = [];
    for (const p of parts) {
      if (p === '..') out.pop();
      else if (p !== '.') out.push(p);
    }
    return out.join('/');
  };

  const meta = (tag) => opf.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
  const title = meta('dc:title');
  const author = meta('dc:creator');
  const lang = meta('dc:language');

  const manifest = {};
  Array.from(opf.getElementsByTagName('item')).forEach((it) => {
    manifest[it.getAttribute('id')] = {
      href: resolve(opfDir, it.getAttribute('href')),
      type: it.getAttribute('media-type') || '',
      props: it.getAttribute('properties') || '',
    };
  });

  // Portada
  let coverItem = Object.values(manifest).find((m) => m.props.includes('cover-image'));
  if (!coverItem) {
    const coverId = Array.from(opf.getElementsByTagName('meta')).find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content');
    if (coverId && manifest[coverId]) coverItem = manifest[coverId];
  }
  if (!coverItem) coverItem = Object.values(manifest).find((m) => m.type.startsWith('image/') && /cover|portada/i.test(m.href));
  let cover = null;
  if (coverItem?.type.startsWith('image/')) {
    const f = zip.file(coverItem.href);
    if (f) cover = new Blob([await f.async('uint8array')], { type: coverItem.type });
  }

  // Índice (TOC): href -> título
  const tocTitles = {};
  const navItem = Object.values(manifest).find((m) => m.props.split(' ').includes('nav'));
  const spineEl = opf.getElementsByTagName('spine')[0];
  const ncxItem = manifest[spineEl?.getAttribute('toc')] || Object.values(manifest).find((m) => m.type === 'application/x-dtbncx+xml');
  if (navItem) {
    const navText = await readText(navItem.href);
    if (navText) {
      const nav = parser.parseFromString(navText, 'application/xhtml+xml');
      const navDir = navItem.href.includes('/') ? navItem.href.slice(0, navItem.href.lastIndexOf('/') + 1) : '';
      nav.querySelectorAll('nav a[href]').forEach((a) => {
        const h = resolve(navDir, a.getAttribute('href'));
        if (!tocTitles[h]) tocTitles[h] = cleanParagraph(a.textContent || '');
      });
    }
  }
  if (!Object.keys(tocTitles).length && ncxItem) {
    const ncxText = await readText(ncxItem.href);
    if (ncxText) {
      const ncx = parser.parseFromString(ncxText, 'application/xml');
      const ncxDir = ncxItem.href.includes('/') ? ncxItem.href.slice(0, ncxItem.href.lastIndexOf('/') + 1) : '';
      Array.from(ncx.getElementsByTagName('navPoint')).forEach((np) => {
        const src = np.getElementsByTagName('content')[0]?.getAttribute('src');
        const label = np.getElementsByTagName('text')[0]?.textContent;
        if (src) {
          const h = resolve(ncxDir, src);
          if (!tocTitles[h]) tocTitles[h] = cleanParagraph(label || '');
        }
      });
    }
  }

  const spine = Array.from(opf.getElementsByTagName('itemref')).map((r) => manifest[r.getAttribute('idref')]).filter(Boolean);
  const paras = [];
  const chapters = [];
  let pendingStart = null;
  for (let i = 0; i < spine.length; i++) {
    onProgress(i / spine.length);
    const item = spine[i];
    if (!/html|xml/.test(item.type)) continue;
    const html = await readText(item.href);
    if (!html) continue;
    let doc = parser.parseFromString(html, 'application/xhtml+xml');
    if (doc.getElementsByTagName('parsererror').length) doc = parser.parseFromString(html, 'text/html');
    const blocks = extractBlocks(doc);
    if (!blocks.length) continue;
    const start = paras.length;
    blocks.forEach((b) => paras.push(b.text));
    const chars = blocks.reduce((n, b) => n + b.text.length, 0);
    const tocTitle = tocTitles[item.href];
    const heading = blocks.find((b) => b.heading)?.text;
    // Páginas muy cortas sin entrada en el índice (créditos, dedicatorias) se unen al siguiente capítulo.
    if (!tocTitle && chars < 400 && i < spine.length - 1) {
      if (pendingStart === null) pendingStart = start;
      continue;
    }
    chapters.push({ title: tocTitle || (heading && heading.length < 90 ? heading : ''), start: pendingStart ?? start, end: paras.length });
    pendingStart = null;
  }
  return { title, author, lang, cover, paras, chapters };
}

/* ---------------- PDF ---------------- */
let pdfjsPromise;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

async function importPdf(file, onProgress) {
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let title = '', author = '';
  try {
    const { info } = await pdf.getMetadata();
    title = info?.Title || '';
    author = info?.Author || '';
    if (/^(untitled|microsoft word|documento|document)/i.test(title)) title = '';
  } catch {}

  // Portada = primera página renderizada.
  let cover = null;
  try {
    const page = await pdf.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 400 / vp1.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
    cover = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
  } catch {}

  // 1) Extraer líneas por página
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    onProgress((n - 1) / pdf.numPages);
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const lines = [];
    let cur = null;
    for (const it of content.items) {
      if (!('str' in it)) continue;
      const y = it.transform[5];
      const h = Math.abs(it.transform[3]) || it.height || 10;
      if (!cur || Math.abs(cur.y - y) > h * 0.5) {
        if (cur && cur.text.trim()) lines.push(cur);
        cur = { y, h, x: it.transform[4], text: it.str, right: it.transform[4] + (it.width || 0) };
      } else {
        cur.text += (cur.text.endsWith(' ') || it.str.startsWith(' ') ? '' : needsSpace(cur, it) ? ' ' : '') + it.str;
        cur.right = it.transform[4] + (it.width || 0);
      }
      if (it.hasEOL && cur) {
        if (cur.text.trim()) lines.push(cur);
        cur = null;
      }
    }
    if (cur && cur.text.trim()) lines.push(cur);
    pages.push(lines);
    page.cleanup();
  }

  // 2) Quitar encabezados / pies repetidos y números de página
  const norm = (s) => s.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
  const edgeCount = new Map();
  pages.forEach((lines) => {
    const edges = new Set([...lines.slice(0, 2), ...lines.slice(-2)].map((l) => norm(l.text)));
    edges.forEach((k) => edgeCount.set(k, (edgeCount.get(k) || 0) + 1));
  });
  const repeated = new Set([...edgeCount].filter(([, c]) => pages.length >= 5 && c >= pages.length * 0.4).map(([k]) => k));

  // 3) Armar párrafos
  const paras = [];
  const pageStart = [];
  for (const lines of pages) {
    pageStart.push(paras.length);
    const kept = lines.filter((l, i) => {
      const t = l.text.trim();
      if (/^[-–—\s]*(\d+|[ivxlc]+)[-–—\s]*$/i.test(t)) return false;
      if ((i < 2 || i >= lines.length - 2) && repeated.has(norm(t))) return false;
      return true;
    });
    if (!kept.length) continue;
    const gaps = [];
    for (let i = 1; i < kept.length; i++) gaps.push(Math.abs(kept[i - 1].y - kept[i].y));
    const typical = median(gaps.filter((g) => g > 0)) || kept[0].h * 1.2;
    const maxRight = Math.max(...kept.map((l) => l.right));
    const minX = Math.min(...kept.map((l) => l.x));
    let buf = [];
    const flush = () => {
      const p = joinLines(buf);
      if (p) paras.push(p);
      buf = [];
    };
    kept.forEach((l, i) => {
      if (i > 0) {
        const prev = kept[i - 1];
        const gap = Math.abs(prev.y - l.y);
        const prevShort = prev.right < maxRight - (maxRight - minX) * 0.15;
        const endsSentence = /[.!?:»”"]$/.test(prev.text.trim());
        const indented = l.x > minX + 8 && /^\p{Lu}|^[«"“¿¡—-]/u.test(l.text.trim());
        if (gap > typical * 1.5 || (endsSentence && (prevShort || indented))) flush();
      }
      buf.push(l.text);
    });
    flush();
  }
  // Un párrafo cortado entre páginas: unir si el anterior no termina en punto.
  for (let i = paras.length - 1; i > 0; i--) {
    if (pageStart.includes(i) && !/[.!?:»”"]$/.test(paras[i - 1]) && /^\p{Ll}/u.test(paras[i])) {
      paras[i - 1] = joinLines([paras[i - 1], paras[i]]);
      paras.splice(i, 1);
      for (let k = 0; k < pageStart.length; k++) if (pageStart[k] >= i && pageStart[k] > 0) pageStart[k]--;
    }
  }

  // 4) Capítulos desde el índice del PDF; si no tiene, bloques de 10 páginas.
  let chapters = [];
  try {
    const outline = await pdf.getOutline();
    if (outline?.length) {
      const items = outline.length >= 3 ? outline : outline.flatMap((o) => [o, ...(o.items || [])]);
      for (const o of items) {
        let dest = o.dest;
        if (typeof dest === 'string') dest = await pdf.getDestination(dest);
        if (!Array.isArray(dest)) continue;
        const pageIndex = await pdf.getPageIndex(dest[0]);
        chapters.push({ title: cleanParagraph(o.title || ''), start: pageStart[pageIndex] ?? 0, end: Infinity });
      }
      chapters = chapters.filter((c, i, a) => i === 0 || c.start > a[i - 1].start);
    }
  } catch {}
  if (chapters.length < 2) {
    chapters = [];
    const step = 10;
    for (let p = 0; p < pages.length; p += step) {
      const last = Math.min(pages.length, p + step);
      chapters.push({ title: `${p + 1}–${last}`, pages: true, start: pageStart[p], end: Infinity });
    }
  }
  chapters.forEach((c, i) => (c.end = i < chapters.length - 1 ? chapters[i + 1].start : paras.length));
  return { title, author, lang: '', cover, paras, chapters };
}

function needsSpace(cur, it) {
  const gap = it.transform[4] - cur.right;
  return gap > (Math.abs(it.transform[0]) || 10) * 0.15;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/* ---------------- DOCX ---------------- */
async function importDocx(file, onProgress) {
  const mammoth = await import('mammoth');
  onProgress(0.2);
  const { value: html } = await (mammoth.default || mammoth).convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  onProgress(0.7);
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const blocks = extractBlocks(doc);
  return fromBlocks(blocks);
}

function fromBlocks(blocks) {
  const paras = blocks.map((b) => b.text);
  const level = ['H1', 'H2', 'H3'].find((h) => blocks.filter((b) => b.heading === h).length >= 2);
  let chapters = [];
  if (level) {
    blocks.forEach((b, i) => {
      if (b.heading === level) chapters.push({ title: b.text, start: i, end: Infinity });
    });
    if (chapters[0]?.start > 0) chapters.unshift({ title: '', start: 0, end: chapters[0].start });
  } else chapters = chunkChapters(paras.length);
  chapters.forEach((c, i) => (c.end = i < chapters.length - 1 ? chapters[i + 1].start : paras.length));
  const title = blocks.find((b) => b.heading === 'H1')?.text || '';
  return { title: level === 'H1' && chapters.length > 1 ? '' : title, author: '', lang: '', cover: null, paras, chapters };
}

/* ---------------- TXT ---------------- */
async function importTxt(file, onProgress) {
  const buf = await file.arrayBuffer();
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('windows-1252').decode(buf);
  }
  onProgress(0.5);
  text = text.replace(/\r\n?/g, '\n');
  const hasBlankLines = (text.match(/\n\s*\n/g) || []).length > 5;
  const rawParas = hasBlankLines ? text.split(/\n\s*\n/).map((p) => joinLines(p.split('\n'))) : text.split('\n').map(cleanParagraph);
  const blocks = rawParas.filter(Boolean).map((t) => ({
    text: t,
    heading: t.length < 80 && /^(cap[ií]tulo|chapter|parte|part|libro|book)\b/i.test(t) ? 'H1' : null,
  }));
  const res = fromBlocks(blocks);
  return { ...res, title: '' };
}
