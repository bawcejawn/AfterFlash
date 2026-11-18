// Backend client for the Apps Script web app.
// Requests are POSTed as text/plain so the browser sends a "simple" CORS request
// (Apps Script can't answer preflights). No cookies, no referrer.
import { config, ownStudio } from './util.js';

/** Backend version this website expects (kept in step with APP_VERSION in backend/Code.gs by CI). */
export const BACKEND_VERSION = '1.10.0';

// Personal accounts: /macros/s/ID/exec. Google Workspace accounts: /a/macros/DOMAIN/s/ID/exec.
const PROD_URL = /^https:\/\/script\.google\.com\/(?:a\/macros\/[A-Za-z0-9.-]+|macros)\/s\/[A-Za-z0-9_-]{20,}\/exec$/;

export class ApiError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

export function backendUrl(studio) {
  if (ownStudio(studio)) return `https://script.google.com/macros/s/${studio.slice(2)}/exec`;
  // AfterFlash Cloud: the API lives on this same site.
  if (config.cloud && (config.backends || {})[studio] === '/api') return '/api';
  // Chrome inserts /u/<n>/ when several Google accounts are signed in; the clean URL is what works for guests.
  const url = String((config.backends || {})[studio] || '').trim().replace(/\/macros\/u\/\d+\/s\//, '/macros/s/');
  if (!url || url.includes('REPLACE_WITH')) throw new ApiError('not_configured', 'This site is not connected to a backend yet. Add your Apps Script URL to config.js.');
  const devOk = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /^\/[a-z0-9/_-]+$/i.test(url);
  if (!PROD_URL.test(url) && !devOk) throw new ApiError('not_configured', 'Backend URL in config.js is not a valid Apps Script /exec URL.');
  return url;
}

const RETRYABLE = new Set(['busy', 'network', 'server_error', 'rate_limited', 'in_progress']);

export async function api(studio, action, payload = {}, { retries = 2, timeout = 45000 } = {}) {
  const url = backendUrl(studio);
  let attempt = 0;
  for (;;) {
    try {
      return await once(url, action, payload, timeout);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'network';
      if (attempt >= retries || !RETRYABLE.has(code)) throw e instanceof ApiError ? e : new ApiError('network', 'Connection problem. Check your signal and try again.');
      attempt++;
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt + Math.random() * 400));
    }
  }
}

async function once(url, action, payload, timeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...payload, a: action }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'follow',
      cache: 'no-store',
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError('network', 'Connection problem. Check your signal and try again.');
  } finally {
    clearTimeout(timer);
  }
  let data;
  try { data = await res.json(); } catch {
    // Apps Script answers with an HTML page when the deployment isn't public or the code failed to load.
    throw new ApiError('backend_misconfigured', 'The backend didn’t answer correctly. In Apps Script, check the web app deployment is set to “Who has access: Anyone”.');
  }
  if (!data || data.ok !== true) throw new ApiError((data && data.error) || 'server_error', data && data.message);
  return data;
}

/** Health check (GET). Resolves to { ok, version } or { ok:false, message }. */
export async function ping(studio) {
  let url;
  try { url = backendUrl(studio); } catch (e) { return { ok: false, message: e.message }; }
  try {
    const res = await fetch(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    const data = await res.json();
    if (data && data.ok && data.app === 'photoshare') return { ok: true, version: data.version, ready: data.ready !== false };
    return { ok: false, message: 'That URL answered, but it isn’t an AfterFlash backend.' };
  } catch {
    return { ok: false, message: 'Can’t reach the backend. Check the URL in config.js and that the deployment’s access is “Anyone”.' };
  }
}
