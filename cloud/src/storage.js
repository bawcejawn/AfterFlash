// Rememberoll storage: photos kept in the owner's Cloudflare R2 bucket (binding STORE) instead of
// the host's Google Drive. Files get ids starting "r2-" so every read knows where to look.
// The hybrid client below has the same methods as the Google Drive client.
import { err } from './lib.js';

export const isCloudId = (id) => typeof id === 'string' && /^r2-[A-Za-z0-9]{30}$/.test(id);
const key = (eventId, id) => `e/${eventId}/${id}`;
const newId = () => {
  const a = new Uint8Array(30); crypto.getRandomValues(a);
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return 'r2-' + Array.from(a, (b) => abc[b % 62]).join('');
};
export const storageActive = (env, a) => !!env.STORE && !!a && Number(a.storage_gb) > 0 && Number(a.storage_until) > Date.now();

/**
 * Drive-shaped client for one event. New files go to R2 when the event uses it (and space is
 * left); otherwise to Google Drive, which is only connected when actually needed.
 */
export function hybridStore({ env, db, ev, account, driveClient }) {
  let d = null;
  const gd = async () => (d = d || await driveClient());
  const bucket = env.STORE;
  const useR2 = () => ev.store === 'r2' && storageActive(env, account);
  const r2 = {
    async upload({ mime, bytes }) {
      const limit = Number(account.storage_gb) * 1e9;
      const r = await db.prepare('UPDATE accounts SET storage_bytes = storage_bytes + ? WHERE id = ? AND storage_bytes + ? <= ? RETURNING storage_bytes')
        .bind(bytes.length, account.id, bytes.length, limit).first();
      if (!r) throw err('storage_full', 'Rememberoll storage is full. The host can add more space on their admin page.');
      account.storage_bytes = r.storage_bytes;
      const id = newId();
      try { await bucket.put(key(ev.id, id), bytes, { httpMetadata: { contentType: mime || 'application/octet-stream' } }); }
      catch (e) { await db.prepare('UPDATE accounts SET storage_bytes = MAX(0, storage_bytes - ?) WHERE id = ?').bind(bytes.length, account.id).run(); throw err('busy', 'Storage didn’t answer. Retrying.'); }
      return id;
    },
  };
  return {
    usesCloud: () => useR2(),
    async upload(f) {
      if (useR2()) {
        try { return await r2.upload(f); }
        catch (e) { if (e.code !== 'storage_full' || !account.refresh_enc) throw e; } // full: keep going on Google Drive if it's connected
      }
      try { return await (await gd()).upload(f); }
      catch (e) {
        // Google Drive is full, but the host has Rememberoll storage: switch this event over and carry on.
        if (e.code === 'drive_full' && storageActive(env, account)) {
          await db.prepare("UPDATE events SET store = 'r2' WHERE id = ?").bind(ev.id).run();
          ev.store = 'r2';
          return r2.upload(f);
        }
        throw e;
      }
    },
    async download(id) {
      if (!isCloudId(id)) return (await gd()).download(id);
      const o = await bucket.get(key(ev.id, id));
      if (!o) throw err('not_found', 'Not found');
      return new Uint8Array(await o.arrayBuffer());
    },
    async share(id, isPublic) { if (!isCloudId(id)) return (await gd()).share(id, isPublic); },
    async trash(id) {
      if (!isCloudId(id)) return (await gd()).trash(id);
      const k = key(ev.id, id);
      const h = await bucket.head(k);
      if (!h) return;
      await bucket.delete(k);
      await db.prepare('UPDATE accounts SET storage_bytes = MAX(0, storage_bytes - ?) WHERE id = ?').bind(h.size || 0, account.id).run();
    },
    async createFolder(name, parent) { return (await gd()).createFolder(name, parent); },
    async list(folder) { return (await gd()).list(folder); },
    async about() { return (await gd()).about(); },
  };
}
