// Хранилище в памяти телефона (IndexedDB). Ничего не уходит в интернет.

const DB_NAME = 'koshelek';
const DB_VER = 1;
export const STORES = ['tx', 'rules', 'imports', 'meta'];
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('tx')) db.createObjectStore('tx', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('rules')) db.createObjectStore('rules', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('imports')) db.createObjectStore('imports', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { dbp = null; reject(r.error); };
  });
  return dbp;
}

const finish = (t) => new Promise((resolve, reject) => {
  t.oncomplete = () => resolve();
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error || new Error('Запись прервана'));
});

export async function getAll(store) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function putMany(store, items) {
  if (!items.length) return;
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  const s = t.objectStore(store);
  for (const it of items) s.put(it);
  return finish(t);
}
export const put = (store, item) => putMany(store, [item]);

export async function delMany(store, keys) {
  if (!keys.length) return;
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  const s = t.objectStore(store);
  for (const k of keys) s.delete(k);
  return finish(t);
}

export async function getMeta(key, fallback) {
  const all = await getAll('meta');
  const row = all.find(r => r.key === key);
  return row ? row.value : fallback;
}
export const setMeta = (key, value) => put('meta', { key, value });

export async function dumpAll() {
  const out = {};
  for (const s of STORES) out[s] = await getAll(s);
  return out;
}

/** Полная замена данных из резервной копии — одной транзакцией. */
export async function replaceAll(data) {
  const db = await open();
  const t = db.transaction(STORES, 'readwrite');
  for (const s of STORES) {
    const st = t.objectStore(s);
    st.clear();
    for (const it of (data[s] || [])) st.put(it);
  }
  return finish(t);
}

export async function persist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {}
  return false;
}
