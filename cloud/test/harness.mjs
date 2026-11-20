// Runs the real worker on Node for tests: D1 on node:sqlite, static assets from ../site, and
// in-memory fakes of Google (OAuth, Drive) and Stripe behind the global fetch.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

const here = path.dirname(new URL(import.meta.url).pathname);
export const SITE_DIR = path.resolve(here, '../../site');

// ---------------------------------------------------------------- D1 shim
export function d1(dir = 'migrations') {
  const db = new DatabaseSync(':memory:');
  for (const f of fs.readdirSync(path.join(here, '..', dir)).sort()) db.exec(fs.readFileSync(path.join(here, '..', dir, f), 'utf8'));
  const size = () => { const a = db.prepare('PRAGMA page_count').get(); const b = db.prepare('PRAGMA page_size').get(); return a.page_count * b.page_size; };
  const norm = (a) => a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
  return {
    raw: db,
    prepare(sql) {
      const bound = (args) => ({
        async first() { return db.prepare(sql).get(...norm(args)) ?? null; },
        async all() { return { results: db.prepare(sql).all(...norm(args)) }; },
        async run() { const r = db.prepare(sql).run(...norm(args)); return { meta: { changes: Number(r.changes), size_after: size() } }; },
      });
      return { bind: (...args) => bound(args), ...bound([]) };
    },
  };
}

// ---------------------------------------------------------------- fake Google + Stripe
export function fakes() {
  const drive = new Map(); // id -> { id, name, mime, parents, bytes, trashed, public, owner }
  const grants = new Map(); // code -> { sub, email, scope }
  const refresh = new Map(); // refresh token -> sub
  const access = new Map(); // access token -> sub
  const sessions = new Map(); // stripe checkout session id -> { paid, email }
  const mail = []; // emails accepted by the fake Resend
  const quota = { usage: 0, limit: 15 * 1024 ** 3 };
  let n = 0;
  const id = (p) => `${p}${(++n).toString(36).padStart(6, '0')}x${Math.random().toString(36).slice(2, 12)}`;
  const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  const who = (req) => access.get(String(req.headers.get('authorization') || '').replace('Bearer ', ''));

  async function handle(url, init = {}) {
    const u = new URL(url);
    const req = new Request(url, init);
    // ---- Google OAuth token endpoint
    if (u.host === 'oauth2.googleapis.com' && u.pathname === '/token') {
      const f = new URLSearchParams(await req.text());
      if (f.get('client_secret') !== 'test-secret') return reply({ error: 'invalid_client' }, 401);
      let sub, scope;
      if (f.get('grant_type') === 'authorization_code') {
        const g = grants.get(f.get('code'));
        if (!g) return reply({ error: 'invalid_grant' }, 400);
        grants.delete(f.get('code'));
        sub = g.sub; scope = g.scope;
        const at = id('at'), rt = id('rt');
        access.set(at, sub); refresh.set(rt, sub);
        const idt = 'x.' + Buffer.from(JSON.stringify({ sub, email: g.email })).toString('base64url') + '.y';
        return reply({ access_token: at, refresh_token: g.noRefresh ? undefined : rt, expires_in: 3599, scope, id_token: idt });
      }
      if (f.get('grant_type') === 'refresh_token') {
        sub = refresh.get(f.get('refresh_token'));
        if (!sub) return reply({ error: 'invalid_grant' }, 400);
        const at = id('at'); access.set(at, sub);
        return reply({ access_token: at, expires_in: 3599 });
      }
      return reply({ error: 'unsupported' }, 400);
    }
    // ---- Drive
    if (u.host === 'www.googleapis.com') {
      const sub = who(req);
      if (!sub) return reply({ error: { code: 401 } }, 401);
      const p = u.pathname;
      if (p === '/upload/drive/v3/files' && req.method === 'POST') {
        const buf = new Uint8Array(await req.arrayBuffer());
        const boundary = /boundary=(\S+)/.exec(req.headers.get('content-type'))[1];
        const text = Buffer.from(buf).toString('latin1');
        const start = text.indexOf('\r\n\r\n', text.indexOf('content-type: application/json')) + 4;
        const metaEnd = text.indexOf(`\r\n--${boundary}`, start);
        const meta = JSON.parse(Buffer.from(buf.subarray(start, metaEnd)).toString('utf8'));
        const bodyStart = text.indexOf('\r\n\r\n', metaEnd + 4) + 4;
        const bodyEnd = text.lastIndexOf(`\r\n--${boundary}--`);
        const bytes = buf.slice(bodyStart, bodyEnd);
        if (quota.usage + bytes.length > quota.limit) return reply({ error: { errors: [{ reason: 'storageQuotaExceeded' }] } }, 403);
        quota.usage += bytes.length;
        const f = { id: id('f'), name: meta.name, mime: meta.mimeType, parents: meta.parents || [], bytes, trashed: false, public: false, owner: sub, created: new Date().toISOString() };
        drive.set(f.id, f);
        return reply({ id: f.id });
      }
      if (p === '/drive/v3/files' && req.method === 'POST') {
        const meta = await req.json();
        const f = { id: id('d'), name: meta.name, mime: meta.mimeType, parents: meta.parents || [], bytes: null, trashed: false, public: false, owner: sub, created: new Date().toISOString() };
        drive.set(f.id, f);
        return reply({ id: f.id });
      }
      if (p === '/drive/v3/files' && req.method === 'GET') {
        const parent = /'([^']+)' in parents/.exec(u.searchParams.get('q'))[1];
        return reply({ files: [...drive.values()].filter((f) => f.owner === sub && !f.trashed && f.parents.includes(parent)).map((f) => ({ id: f.id, name: f.name, mimeType: f.mime, size: String(f.bytes ? f.bytes.length : 0), createdTime: f.created })) });
      }
      if (p === '/drive/v3/about') return reply({ storageQuota: { usage: String(quota.usage), limit: String(quota.limit) }, user: { emailAddress: 'host@example.com' } });
      const m = /^\/drive\/v3\/files\/([^/]+)(\/permissions(?:\/([^/]+))?)?$/.exec(p);
      if (m) {
        const f = drive.get(decodeURIComponent(m[1]));
        if (!f || f.owner !== sub) return reply({ error: { code: 404 } }, 404);
        if (m[2] && req.method === 'POST') { f.public = true; return reply({ id: 'anyoneWithLink' }); }
        if (m[2] && req.method === 'DELETE') { if (!f.public) return reply({}, 404); f.public = false; return new Response(null, { status: 204 }); }
        if (req.method === 'PATCH') { Object.assign(f, await req.json()); return reply({ id: f.id }); }
        if (u.searchParams.get('alt') === 'media') return new Response(f.bytes, { headers: { 'content-type': f.mime } });
        return reply({ id: f.id, name: f.name });
      }
      return reply({ error: 'unknown ' + p }, 404);
    }
    // ---- Resend (email)
    if (u.host === 'api.resend.com') {
      if (req.headers.get('authorization') !== 'Bearer re_test_fake') return reply({ message: 'bad key' }, 401);
      const body = JSON.parse(await req.text());
      for (const m of body) mail.push(m);
      return reply({ data: body.map(() => ({ id: id('em') })) });
    }
    // ---- Stripe
    if (u.host === 'api.stripe.com') {
      if (req.headers.get('authorization') !== 'Bearer sk_test_fake') return reply({ error: { message: 'bad key' } }, 401);
      if (u.pathname === '/v1/checkout/sessions' && req.method === 'POST') {
        const f = new URLSearchParams(await req.text());
        const sid = 'cs_test_' + Math.random().toString(36).slice(2) + 'abcdefghij';
        const metadata = {};
        for (const [k, v] of f) { const m = /^metadata\[(\w+)\]$/.exec(k); if (m) metadata[m[1]] = v; }
        sessions.set(sid, { paid: false, email: 'buyer@example.com', metadata, amount: Number(f.get('line_items[0][price_data][unit_amount]')) || 0, name: f.get('line_items[0][price_data][product_data][name]'), success: f.get('success_url').replace('{CHECKOUT_SESSION_ID}', sid) });
        return reply({ id: sid, url: `https://checkout.stripe.com/c/pay/${sid}` });
      }
      const m = /^\/v1\/checkout\/sessions\/(.+)$/.exec(u.pathname);
      if (m) {
        const s = sessions.get(decodeURIComponent(m[1]));
        if (!s) return reply({ error: { message: 'No such checkout.session' } }, 404);
        return reply({ id: m[1], payment_status: s.paid ? 'paid' : 'unpaid', customer_details: { email: s.email }, amount_total: s.amount, metadata: s.metadata, livemode: false,
          ...(s.paid ? { collected_information: { shipping_details: { name: 'Sam Host', address: { line1: '1 Main St', city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' } } } } : {}) });
      }
    }
    return null;
  }

  return {
    drive, sessions, quota, grants, refresh, mail,
    /** Simulate the user approving Google sign-in: returns the code Google would send back. */
    approve({ sub = 'google-sub-1', email = 'host@example.com', scope = 'openid email https://www.googleapis.com/auth/drive.file', noRefresh = false } = {}) {
      const code = id('code'); grants.set(code, { sub, email, scope, noRefresh }); return code;
    },
    pay(sid) { sessions.get(sid).paid = true; return sessions.get(sid).success; },
    handle,
  };
}

/** Make an env + install the fakes in front of the real fetch. */
export function makeEnv(extra = {}) {
  const fk = fakes();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => (await fk.handle(String(url), init)) || realFetch(url, init);
  const env = {
    DB: d1(),
    SITE_ORIGIN: 'http://localhost:8788',
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
    STRIPE_SECRET_KEY: 'sk_test_fake', PRINT_PRICE: '0.50', BOOK_PRICE: '79', PRICE_EVENT: '$5', PRICE_MONTH: '$10', PRICE_YEAR: '$30',
    DATA_KEY: 'test-data-key-0123456789abcdef0123456789', OWNER_KEY: 'owner-key-for-tests-0123456789',
    ASSETS: { fetch: (req) => serveAsset(new URL(req.url).pathname) },
    ...extra,
  };
  return { env, fk, worker };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg' };
export function serveAsset(pathname) {
  let p = path.normalize(path.join(SITE_DIR, decodeURIComponent(pathname)));
  if (!p.startsWith(SITE_DIR)) return new Response('no', { status: 403 });
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) return new Response(fs.readFileSync(path.join(SITE_DIR, '404.html')), { status: 404, headers: { 'content-type': 'text/html' } });
  return new Response(fs.readFileSync(p), { headers: { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' } });
}

/** In-memory stand-in for a Cloudflare R2 bucket binding (just the calls the app uses). */
export function fakeR2() {
  const m = new Map();
  const obj = (k) => { const b = m.get(k); return b && { key: k, size: b.length, async arrayBuffer() { return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } }; };
  return {
    objects: m,
    async put(k, bytes) { m.set(k, new Uint8Array(bytes)); return { key: k }; },
    async get(k) { return obj(k) || null; },
    async head(k) { return obj(k) || null; },
    async delete(k) { for (const x of [].concat(k)) m.delete(x); },
    async list({ prefix = '', limit = 1000 } = {}) {
      const objects = [...m.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map(obj);
      return { objects, truncated: false };
    },
  };
}
