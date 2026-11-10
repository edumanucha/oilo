import { openDB } from 'idb';

// Todo se guarda en el propio dispositivo (IndexedDB). Nada sale del celular.
const dbPromise = openDB('oilo', 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore('books', { keyPath: 'id' });
      db.createObjectStore('texts', { keyPath: 'id' });
      db.createObjectStore('progress', { keyPath: 'id' });
      db.createObjectStore('settings');
    }
    // Audio ya preparado: clave "libro|voz|capítulo|frase" → WAV.
    if (oldVersion < 2) db.createObjectStore('audio');
  },
});

/* ---------- audio preparado por adelantado ---------- */
const prefixRange = (prefix) => IDBKeyRange.bound(prefix, prefix + '￿');

export async function getAudio(key) {
  return (await dbPromise).get('audio', key);
}
export async function putAudio(key, blob) {
  await (await dbPromise).put('audio', blob, key);
}
export async function audioKeys(prefix) {
  return (await dbPromise).getAllKeys('audio', prefixRange(prefix));
}
export async function deleteAudio(prefix) {
  const db = await dbPromise;
  await db.delete('audio', prefixRange(prefix));
}
// Borra el audio de libros que no se abren hace más de `days` días.
export async function purgeOldAudio(days = 30) {
  const db = await dbPromise;
  const limit = Date.now() - days * 86400000;
  const progress = await db.getAll('progress');
  const books = await db.getAll('books');
  for (const b of books) {
    const p = progress.find((x) => x.id === b.id);
    const last = p?.updatedAt || b.addedAt || 0;
    if (last < limit) await db.delete('audio', prefixRange(b.id + '|'));
  }
}
export async function audioUsageMB() {
  const db = await dbPromise;
  let bytes = 0;
  let cursor = await db.transaction('audio').store.openCursor();
  while (cursor) {
    bytes += cursor.value?.size || 0;
    cursor = await cursor.continue();
  }
  return Math.round(bytes / 1e6);
}

export async function listBooks() {
  const db = await dbPromise;
  const [books, progress] = await Promise.all([db.getAll('books'), db.getAll('progress')]);
  const byId = Object.fromEntries(progress.map((p) => [p.id, p]));
  return books
    .map((b) => ({ ...b, progress: byId[b.id] || null }))
    .sort((a, b) => (b.progress?.updatedAt || b.addedAt) - (a.progress?.updatedAt || a.addedAt));
}

export async function getBook(id) {
  const db = await dbPromise;
  const [book, progress] = await Promise.all([db.get('books', id), db.get('progress', id)]);
  return book ? { ...book, progress: progress || null } : null;
}

export async function getText(id) {
  const db = await dbPromise;
  return (await db.get('texts', id))?.paras || [];
}

export async function saveBook(book, paras) {
  const db = await dbPromise;
  const tx = db.transaction(['books', 'texts'], 'readwrite');
  const { progress, ...meta } = book;
  await tx.objectStore('books').put(meta);
  if (paras) await tx.objectStore('texts').put({ id: book.id, paras });
  await tx.done;
}

export async function updateBook(id, patch) {
  const db = await dbPromise;
  const book = await db.get('books', id);
  if (!book) return;
  await db.put('books', { ...book, ...patch });
}

export async function deleteBook(id) {
  const db = await dbPromise;
  const tx = db.transaction(['books', 'texts', 'progress'], 'readwrite');
  await Promise.all([
    (await dbPromise).delete('audio', IDBKeyRange.bound(id + '|', id + '|￿')),
    tx.objectStore('books').delete(id),
    tx.objectStore('texts').delete(id),
    tx.objectStore('progress').delete(id),
  ]);
  await tx.done;
}

export async function saveProgress(id, data) {
  const db = await dbPromise;
  await db.put('progress', { id, ...data, updatedAt: Date.now() });
}

export async function getSetting(key, fallback) {
  const db = await dbPromise;
  const v = await db.get('settings', key);
  return v === undefined ? fallback : v;
}

export async function setSetting(key, value) {
  const db = await dbPromise;
  await db.put('settings', value, key);
}

// Pide al navegador que no borre los libros si el celular se queda sin espacio.
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {}
}
