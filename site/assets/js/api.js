// Backend client for the Apps Script web app.
// Requests are POSTed as text/plain so the browser sends a "simple" CORS request
// (Apps Script can't answer preflights). No cookies, no referrer.
import { config } from './util.js';

const PROD_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;

export class ApiError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

export function backendUrl(studio) {
  const url = (config.backends || {})[studio];
  if (!url) throw new ApiError('not_configured', 'This site is not connected to a backend yet.');
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
  try { data = await res.json(); } catch { throw new ApiError('server_error', 'Unexpected response from server.'); }
  if (!data || data.ok !== true) throw new ApiError((data && data.error) || 'server_error', data && data.message);
  return data;
}
