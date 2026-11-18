// Offline-first upload queue in IndexedDB. Photos are saved on the phone first and
// uploaded when there is signal, so nothing is lost on weak venue Wi-Fi.
import { api, ApiError } from './api.js';
import { blobToBase64 } from './util.js';
import { encryptBlob, sha256HexOf } from './crypto.js';

const DB = 'photoshare';
let dbp;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { keyPath: 'clientId' }).createIndex('ev', 'ev');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

function tx(store, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const queue = {
  add(item) { return tx('queue', 'readwrite', (s) => s.put(item)); },
  remove(id) { return tx('queue', 'readwrite', (s) => s.delete(id)); },
  list(ev) { return tx('queue', 'readonly', (s) => reqP(s.index('ev').getAll(ev))); },
  update(item) { return tx('queue', 'readwrite', (s) => s.put(item)); },
};

const FATAL = new Set(['no_shots', 'closed', 'bad_type', 'too_large', 'blocked', 'no_video', 'full', 'not_found', 'bad_request']);

/**
 * Upload everything waiting for this event, one at a time.
 * onEvent({type:'uploaded'|'dropped'|'waiting'|'auth', item, result, error})
 */
export function createUploader({ studio, ev, getAuth, onEvent }) {
  let running = false;
  let wake = null;

  async function run() {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const items = (await queue.list(ev)).sort((a, b) => a.createdAt - b.createdAt);
        if (!items.length) break;
        if (!navigator.onLine) { onEvent({ type: 'waiting', count: items.length }); break; }
        const item = items[0];
        const auth = getAuth();
        if (!auth) { onEvent({ type: 'auth' }); break; }
        try {
          // Private-storage events: encrypt on the phone; the server only ever sees ciphertext.
          const key = auth.key;
          const mainBlob = key ? await encryptBlob(key, item.blob) : item.blob;
          const thumbBlob = item.thumb ? (key ? await encryptBlob(key, item.thumb) : item.thumb) : null;
          const payload = {
            e: ev.split(':')[1], g: auth.g, t: auth.t, kind: item.kind, clientId: item.clientId,
            w: item.w, h: item.h, dur: item.dur, blur: item.blur,
            data: await blobToBase64(mainBlob),
            thumb: thumbBlob ? await blobToBase64(thumbBlob) : undefined,
            mime: key ? String(item.blob.type || '').split(';')[0] : undefined,
            sha: key ? await sha256HexOf(item.blob) : undefined,
          };
          const result = await api(studio, 'upload', payload, { retries: 1, timeout: 120000 });
          await queue.remove(item.clientId);
          onEvent({ type: 'uploaded', item, result });
        } catch (e) {
          const code = e instanceof ApiError ? e.code : 'network';
          if (FATAL.has(code)) {
            await queue.remove(item.clientId);
            onEvent({ type: 'dropped', item, error: e });
          } else if (code === 'needs_update') {
            // Private event and this phone doesn't have the event key yet: fetch it, keep the photo.
            onEvent({ type: 'refresh', error: e });
            await new Promise((r) => setTimeout(r, 3000));
            if (!getAuth() || !getAuth().key) break;
          } else if (code === 'unauthorized') {
            onEvent({ type: 'auth', error: e });
            break;
          } else {
            item.attempts = (item.attempts || 0) + 1;
            await queue.update(item);
            onEvent({ type: 'waiting', count: items.length, error: e });
            await new Promise((r) => { wake = r; setTimeout(r, Math.min(60000, 2000 * 2 ** Math.min(item.attempts, 5))); });
          }
        }
      }
    } finally {
      running = false;
    }
  }

  window.addEventListener('online', () => { if (wake) wake(); run(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
  return { run, kick() { if (wake) wake(); run(); } };
}
