// Google sign-in and Drive access for one host account. Uses only the drive.file scope: the
// app can see and change files it created in the host's Drive, and nothing else there.
import { err, seal, unseal } from './lib.js';

export const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'];
const OAUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export function authUrl(env, state, { consent = true } = {}) {
  const u = new URL(OAUTH);
  u.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  u.searchParams.set('redirect_uri', redirectUri(env));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES.join(' '));
  u.searchParams.set('state', state);
  u.searchParams.set('include_granted_scopes', 'true');
  if (consent) { u.searchParams.set('access_type', 'offline'); u.searchParams.set('prompt', 'consent'); }
  else u.searchParams.set('prompt', 'select_account');
  return u.toString();
}
export const redirectUri = (env) => `${env.SITE_ORIGIN}/oauth/callback`;

/** Exchange the code from Google for tokens; returns { refresh, access, sub, email }. */
export async function exchangeCode(env, code) {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri(env), grant_type: 'authorization_code' }),
  });
  const t = await res.json().catch(() => ({}));
  if (!res.ok || !t.access_token) throw err('google_failed', 'Google sign-in didn’t complete. Please try again.');
  const claims = decodeJwt(t.id_token);
  if (!claims.sub) throw err('google_failed', 'Google sign-in didn’t return an account.');
  const granted = String(t.scope || '').split(' ');
  return { refresh: t.refresh_token || '', access: t.access_token, expires: Date.now() + (Number(t.expires_in) || 3000) * 1000, sub: String(claims.sub), email: String(claims.email || ''), driveOk: granted.includes('https://www.googleapis.com/auth/drive.file') };
}

function decodeJwt(jwt) {
  try {
    const p = String(jwt).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(p))));
  } catch { return {}; }
}

/** A Drive client for a host account (refreshes and caches the access token). */
const tokenCache = new Map();
export async function driveFor(env, db, account) {
  if (!account.refresh_enc) throw err('drive_not_connected', 'This host hasn’t connected Google Drive yet.');
  let cached = tokenCache.get(account.id);
  const access = async () => {
    if (cached && cached.exp > Date.now() + 60000) return cached.token;
    const refresh = await unseal(env, account.refresh_enc);
    const res = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ refresh_token: refresh, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token' }),
    });
    const t = await res.json().catch(() => ({}));
    if (!res.ok || !t.access_token) {
      if (t.error === 'invalid_grant') {
        // The host removed access in their Google account: mark it so the dashboard asks to reconnect.
        await db.prepare('UPDATE accounts SET refresh_enc = \'\' WHERE id = ?').bind(account.id).run();
        tokenCache.delete(account.id);
        throw err('drive_not_connected', 'The host’s Google Drive was disconnected. They need to reconnect it on their admin page.');
      }
      throw err('busy', 'Google Drive didn’t answer. Retrying.');
    }
    cached = { token: t.access_token, exp: Date.now() + (Number(t.expires_in) || 3000) * 1000 };
    tokenCache.set(account.id, cached);
    return cached.token;
  };
  const call = async (url, init = {}, { raw = false, okStatus = [] } = {}) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${await access()}` } });
      if (res.ok || okStatus.includes(res.status)) return raw ? res : (res.status === 204 ? {} : res.json());
      if (res.status === 401 && attempt === 0) { cached = null; tokenCache.delete(account.id); continue; }
      if ((res.status === 429 || res.status >= 500) && attempt < 2) { await new Promise((r) => setTimeout(r, 400 * 2 ** attempt)); continue; }
      const body = await res.text().catch(() => '');
      if (res.status === 403 && /storageQuotaExceeded|quotaExceeded/.test(body)) throw err('drive_full', 'The host’s Google Drive is full. They can free up space or add storage from Google.');
      if (res.status === 404) throw err('not_found', 'Not found');
      throw err('busy', `Google Drive error (${res.status}). Retrying.`);
    }
  };
  return {
    async createFolder(name, parent) {
      const r = await call(`${DRIVE}/files?fields=id`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: parent ? [parent] : undefined }) });
      return r.id;
    },
    async upload({ name, mime, parent, bytes }) {
      const boundary = 'ps' + Math.random().toString(36).slice(2);
      const meta = new TextEncoder().encode(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent], mimeType: mime })}\r\n--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`);
      const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
      const body = new Uint8Array(meta.length + bytes.length + tail.length);
      body.set(meta); body.set(bytes, meta.length); body.set(tail, meta.length + bytes.length);
      const r = await call(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body });
      return r.id;
    },
    async download(id) {
      const res = await call(`${DRIVE}/files/${encodeURIComponent(id)}?alt=media`, {}, { raw: true });
      return new Uint8Array(await res.arrayBuffer());
    },
    async share(id, isPublic) {
      if (isPublic) await call(`${DRIVE}/files/${encodeURIComponent(id)}/permissions?fields=id`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'reader', type: 'anyone' }) });
      else await call(`${DRIVE}/files/${encodeURIComponent(id)}/permissions/anyoneWithLink`, { method: 'DELETE' }, { okStatus: [404] });
    },
    async trash(id) {
      await call(`${DRIVE}/files/${encodeURIComponent(id)}?fields=id`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashed: true }) }, { okStatus: [404] });
    },
    async list(folder) {
      const q = `'${folder.replace(/'/g, '')}' in parents and trashed = false`;
      const r = await call(`${DRIVE}/files?q=${encodeURIComponent(q)}&pageSize=1000&fields=files(id,name,mimeType,size,createdTime)`);
      return r.files || [];
    },
    async about() {
      return call(`${DRIVE}/about?fields=storageQuota,user(emailAddress)`);
    },
  };
}

export async function sealRefresh(env, refresh) { return seal(env, refresh); }
