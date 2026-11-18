// PhotoShare Cloud worker: serves the website (static assets from ../site), the JSON API at
// /api, the Google "Connect Drive" callback at /oauth/callback, and a config.js built from
// this deployment's settings.
import { ACTIONS, VERSION, makeCtx } from './actions.js';
import { ApiErr, randomKey, sha256Hex } from './lib.js';
import { authUrl, exchangeCode, sealRefresh } from './google.js';
import { ON_SALE, PLAN_NAMES, planPrices, money } from './stripe.js';

const BODY_LIMIT = 30 * 1024 * 1024;
const SEC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'strict-transport-security': 'max-age=31536000',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SEC_HEADERS } });
}
const redirect = (url) => new Response(null, { status: 302, headers: { location: url, 'cache-control': 'no-store', ...SEC_HEADERS } });

export async function handleApi(request, env) {
  if (request.method === 'GET') return json({ ok: true, app: 'photoshare', version: VERSION, ready: true, cloud: true });
  if (request.method !== 'POST') return json({ ok: false, error: 'bad_request', message: 'Use POST' }, 405);
  // Only this site's own pages may call the API from a browser.
  const origin = request.headers.get('origin');
  if (origin && origin !== env.SITE_ORIGIN) return json({ ok: false, error: 'forbidden', message: 'Wrong origin' }, 403);
  const len = Number(request.headers.get('content-length') || 0);
  if (len > BODY_LIMIT) return json({ ok: false, error: 'too_large', message: 'Request too large' });
  let req, a;
  try {
    const text = await request.text();
    if (text.length > BODY_LIMIT) return json({ ok: false, error: 'too_large', message: 'Request too large' });
    try { req = JSON.parse(text); } catch { return json({ ok: false, error: 'bad_request', message: 'Invalid JSON' }); }
    if (!req || typeof req !== 'object' || typeof req.a !== 'string') return json({ ok: false, error: 'bad_request', message: 'Missing action' });
    a = req.a;
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, a)) return json({ ok: false, error: 'bad_request', message: 'Unknown action' });
    const out = await ACTIONS[a](makeCtx(env), req);
    out.ok = true;
    return json(out);
  } catch (e) {
    if (e instanceof ApiErr) return json({ ok: false, error: e.code, message: e.message });
    console.error(a, e && e.stack ? e.stack : e);
    return json({ ok: false, error: 'server_error', message: 'Something went wrong. Please try again.' });
  }
}

const COOKIE = 'ps_oauth';
const cookieOf = (request) => (/(?:^|;\s*)ps_oauth=([A-Za-z0-9_-]{20,64})/.exec(request.headers.get('cookie') || '') || [])[1] || '';

/**
 * Step 1 of a Google round trip: remember (in a cookie) which browser started it, then go to
 * Google. The callback only accepts the browser that started, so a link someone else made can't
 * attach your Google Drive to their account.
 */
export async function handleOAuthStart(request, env) {
  const s = new URL(request.url).searchParams.get('s') || '';
  const c = makeCtx(env);
  const row = /^[A-Za-z0-9_-]{20,64}$/.test(s) && await c.one("SELECT * FROM oauth_state WHERE state = ? AND exp > ? AND purpose IN ('connect', 'recover')", s, Date.now());
  if (!row) return redirect(`${env.SITE_ORIGIN}/admin.html?drive=expired`);
  const secure = env.SITE_ORIGIN.startsWith('https:') ? '; Secure' : '';
  return new Response(null, { status: 302, headers: {
    location: authUrl(env, s, { consent: row.purpose === 'connect' }),
    'set-cookie': `${COOKIE}=${s}; Path=/oauth; Max-Age=900; HttpOnly; SameSite=Lax${secure}`,
    'cache-control': 'no-store', ...SEC_HEADERS } });
}

export async function handleOAuth(request, env) {
  const url = new URL(request.url);
  const clear = `${COOKIE}=; Path=/oauth; Max-Age=0; HttpOnly; SameSite=Lax`;
  const back = (path) => new Response(null, { status: 302, headers: { location: `${env.SITE_ORIGIN}${path}`, 'set-cookie': clear, 'cache-control': 'no-store', ...SEC_HEADERS } });
  const state = url.searchParams.get('state') || '';
  const c = makeCtx(env);
  const row = state && state === cookieOf(request) && await c.one('SELECT * FROM oauth_state WHERE state = ? AND exp > ?', state, Date.now());
  if (state) await c.run('DELETE FROM oauth_state WHERE state = ? OR exp < ?', state, Date.now());
  if (!row || (row.purpose !== 'connect' && row.purpose !== 'recover')) return back('/admin.html?drive=expired');
  const dest = row.purpose === 'connect' ? '/admin.html?drive=' : '/admin.html?recover=';
  if (url.searchParams.get('error') || !url.searchParams.get('code')) return back(dest + 'cancelled');
  let t;
  try { t = await exchangeCode(env, url.searchParams.get('code')); } catch { return back(dest + 'error'); }
  if (row.purpose === 'connect') {
    if (!t.driveOk) return back('/admin.html?drive=noscope');
    if (!t.refresh) return back('/admin.html?drive=error');
    await c.run('UPDATE accounts SET refresh_enc = ?, google_sub = ?, google_email = ? WHERE id = ?', await sealRefresh(env, t.refresh), t.sub, t.email, row.account);
    return back('/admin.html?drive=connected');
  }
  // recover: the Google account must be one already connected to a PhotoShare account
  const acct = await c.one("SELECT id FROM accounts WHERE google_sub = ? AND status = 'active' AND kind != 'owner' ORDER BY created DESC LIMIT 1", t.sub);
  if (!acct) return back('/admin.html?recover=unknown');
  const ticket = randomKey(24);
  await c.run('INSERT INTO oauth_state (state, account, purpose, exp) VALUES (?, ?, ?, ?)', ticket, acct.id, 'ticket', Date.now() + 5 * 60000);
  return back('/admin.html#recover=' + encodeURIComponent(ticket));
}

const PLAN_NOTES = { event: 'One event, open 30 days', month: 'Unlimited events for 30 days', year: 'Unlimited events for a year' };
function plansFor(env) {
  const p = planPrices(env);
  return ON_SALE.map((id) => ({ id, name: PLAN_NAMES[id], price: money(p[id]), cents: p[id], note: PLAN_NOTES[id], on: !!env.STRIPE_SECRET_KEY, best: id === 'year' }));
}

export function configJs(env) {
  const cfg = {
    appName: env.APP_NAME || 'PhotoShare',
    backends: { main: '/api' },
    cloud: {
      plans: plansFor(env),
      price: money(planPrices(env).event),
      holdMonths: 12,
      support: env.SUPPORT_EMAIL || '',
      business: env.BUSINESS_NAME || env.APP_NAME || 'PhotoShare',
      testMode: String(env.STRIPE_SECRET_KEY || '').startsWith('sk_test_'),
      payments: !!env.STRIPE_SECRET_KEY,
      google: !!env.GOOGLE_CLIENT_ID,
    },
    koinos: { rpc: '', contract: '', explorer: '' },
    driveBase: env.DRIVE_BASE || 'https://drive.google.com',
    ...(env.IMAGE_BASE ? { imageBase: env.IMAGE_BASE } : {}),
  };
  return new Response(`export default ${JSON.stringify(cfg)};\n`, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', ...SEC_HEADERS } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api') return handleApi(request, env);
    if (url.pathname === '/oauth/start') return handleOAuthStart(request, env);
    if (url.pathname === '/oauth/callback') return handleOAuth(request, env);
    if (url.pathname === '/config.js') return configJs(env);
    // Google Search Console ownership file (needed to verify the site for Google sign-in branding)
    if (env.GOOGLE_SITE_VERIFICATION && url.pathname === `/${env.GOOGLE_SITE_VERIFICATION}` && /^google[a-z0-9]+\.html$/.test(env.GOOGLE_SITE_VERIFICATION)) {
      return new Response(`google-site-verification: ${env.GOOGLE_SITE_VERIFICATION}`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname === '/setup.html') return redirect(`${env.SITE_ORIGIN}/index.html#pricing`); // self-hosting isn't offered here
    return env.ASSETS.fetch(request);
  },
};

export { sha256Hex };
