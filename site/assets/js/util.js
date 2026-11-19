// Shared helpers. Every piece of user/remote text goes through textContent — never innerHTML.
import config from '../../config.js';
import qrcode from '../vendor/qrcode.mjs';

export { config };

// Refuse to run inside a frame (clickjacking protection; GitHub Pages can't send headers).
export function frameGuard() {
  if (window.top !== window.self) {
    document.documentElement.textContent = '';
    throw new Error('Framing not allowed');
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** h('div', {class:'x', onclick: fn}, 'text', child) — safe element builder. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'href' || k === 'src') el.setAttribute(k, safeUrl(v));
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Only allow http(s), blob:, data:image and relative URLs into href/src. */
export function safeUrl(u) {
  const s = String(u);
  if (/^\/\//.test(s)) return 'about:blank'; // protocol-relative: could point off-site
  if (/^(https?:|blob:|data:image\/(png|jpeg|gif|webp);|\.{0,2}\/|[a-z0-9_-]+\.html|#|\?)/i.test(s)) return s;
  if (/^[a-z0-9_./-]+$/i.test(s)) return s;
  return 'about:blank';
}

/** Empty an element; returns { append } that skips null/false children (conditional UI). */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return {
    append(...children) {
      el.append(...children.flat().filter((c) => c != null && c !== false).map((c) => (c instanceof Node ? c : String(c))));
      return el;
    },
  };
}

let toastRoot;
export function toast(msg, kind = '') {
  if (!toastRoot) { toastRoot = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastRoot); }
  const t = h('div', { class: 'toast ' + kind }, msg);
  toastRoot.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3500);
}

// ---------- ids / params
export const isEventId = (s) => typeof s === 'string' && /^[A-Za-z0-9]{6,20}$/.test(s);
export const isDriveId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{10,120}$/.test(s);

export function params() {
  const q = new URLSearchParams(location.search);
  const f = new URLSearchParams(location.hash.slice(1));
  return { q, f };
}

// ---------- studios
// A studio is one Rememberoll backend (a Google Apps Script web app in someone's own Google
// account). Built-in studios are listed in config.js. Friends run their own: their links carry
// ?b=<deployment id>, which can only ever mean https://script.google.com/macros/s/<id>/exec.
export const DEPLOYMENT_ID = /^AKfy[A-Za-z0-9_-]{20,140}$/;
export const ownStudio = (s) => typeof s === 'string' && s.startsWith('b.') && DEPLOYMENT_ID.test(s.slice(2));
export const studioOfDeployment = (id) => (DEPLOYMENT_ID.test(id) ? 'b.' + id : '');
/** Studios this device has set up or signed in to as an organizer (never filled from a link). */
export const myStudios = {
  list() { const l = store.get('ps:studios'); return Array.isArray(l) ? l.filter((x) => x && ownStudio(x.id)) : []; },
  add(id, name) { if (!ownStudio(id)) return; const l = myStudios.list().filter((x) => x.id !== id); l.unshift({ id, name: String(name || 'My Rememberoll').slice(0, 40), added: Date.now() }); store.set('ps:studios', l.slice(0, 10)); },
  has(id) { return myStudios.list().some((x) => x.id === id); },
  remove(id) { store.set('ps:studios', myStudios.list().filter((x) => x.id !== id)); },
};
/** Whether a studio key is one this site knows how to reach (built-in or a deployment id). */
export const knownStudio = (s) => ownStudio(s) || Object.prototype.hasOwnProperty.call(config.backends || {}, s);

/** Resolve which backend ("studio") a link refers to. Unknown keys are refused. */
export function studioFrom(q) {
  const b = q.get('b');
  if (b) {
    if (!DEPLOYMENT_ID.test(b)) throw new Error('Unknown studio in link');
    return 'b.' + b;
  }
  const keys = Object.keys(config.backends || {});
  const s = q.get('s');
  if (!s) return keys[0];
  if (!keys.includes(s)) throw new Error('Unknown studio in link');
  return s;
}

export function siteBase() {
  return location.origin + location.pathname.replace(/[^/]*$/, '');
}

export function link(page, { e, s, extra = {}, frag = {} } = {}) {
  const u = new URL(page, siteBase());
  if (e) u.searchParams.set('e', e);
  const keys = Object.keys(config.backends || {});
  if (ownStudio(s)) u.searchParams.set('b', s.slice(2));
  else if (s && s !== keys[0]) u.searchParams.set('s', s);
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== '') u.searchParams.set(k, v);
  const f = new URLSearchParams();
  for (const [k, v] of Object.entries(frag)) if (v) f.set(k, v);
  const fs = f.toString();
  return u.toString() + (fs ? '#' + fs : '');
}

// ---------- media URLs (Google Drive)
export function thumbUrl(id, w = 800) {
  if (!isDriveId(id)) return '';
  return `${config.driveBase}/thumbnail?id=${encodeURIComponent(id)}&sz=w${w | 0}`;
}
/** Google's image CDN form of a public Drive file — loads without a Google sign-in. */
export function cdnUrl(id, w = 800) {
  if (!isDriveId(id)) return '';
  return `${config.imageBase || 'https://lh3.googleusercontent.com'}/d/${encodeURIComponent(id)}=w${w | 0}`;
}

/**
 * Point an <img> at a Drive photo, trying the image CDN, then Drive's thumbnail URL, then an
 * optional proxy (async () => blobUrl). Treats tiny placeholder icons as failures.
 * Calls onReady() once a real image is showing.
 */
export function loadDriveImage(img, id, w, { proxy, onReady } = {}) {
  const sources = [cdnUrl(id, w), thumbUrl(id, w)].filter(Boolean);
  let i = 0;
  let usedProxy = false;
  const next = async () => {
    if (i < sources.length) { img.src = sources[i++]; return; }
    if (proxy && !usedProxy) {
      usedProxy = true;
      try { const url = await proxy(); if (url) { img.src = url; return; } } catch { /* fall through */ }
    }
    img.classList.add('img-failed');
  };
  img.onerror = () => next();
  img.onload = () => {
    // Google sometimes answers with a small generic icon instead of the photo.
    if (img.naturalWidth > 0 && img.naturalWidth < 64 && Math.max(w, 64) > 64 && !img.src.startsWith('blob:')) { next(); return; }
    img.classList.remove('img-failed');
    if (onReady) onReady(img);
  };
  next();
  return img;
}

/** Run async jobs one at a time (used for proxy fallbacks so a big album doesn't flood the backend). */
export function serial() {
  let chain = Promise.resolve();
  return (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
}

export function videoUrl(id) {
  if (!isDriveId(id)) return '';
  return `${config.driveBase}/uc?export=download&id=${encodeURIComponent(id)}`;
}

export function downloadUrl(id) {
  if (!isDriveId(id)) return '';
  return `${config.driveBase}/uc?export=download&id=${encodeURIComponent(id)}`;
}
export function previewUrl(id) {
  if (!isDriveId(id)) return '';
  return `${config.driveBase}/file/d/${encodeURIComponent(id)}/preview`;
}

// ---------- storage (never throws)
export const store = {
  get(k, area = localStorage) { try { return JSON.parse(area.getItem(k)); } catch { return null; } },
  set(k, v, area = localStorage) { try { area.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k, area = localStorage) { try { area.removeItem(k); } catch { /* ignore */ } },
};

// ---------- QR as SVG built from the module matrix (no innerHTML)
export function qrSvg(text, { margin = 2, dark = '#1d2433' } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code');
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', size); bg.setAttribute('height', size); bg.setAttribute('fill', '#fff');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d); p.setAttribute('fill', dark);
  svg.append(bg, p);
  return svg;
}

// ---------- formatting
export function fmtDate(s) {
  if (!s) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s);
  if (isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}
export function fmtWhen(ms) {
  const d = new Date(ms);
  return isNaN(d) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export function fmtCountdown(ms) {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), hr = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${hr}h`;
  if (hr > 0) return `${hr}h ${m}m`;
  return `${m}m ${s % 60}s`;
}
export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / 1024 ** i).toFixed(i ? 1 : 0) + ' ' + u[i];
}

/** ISO string → value for <input type=datetime-local> in local time. */
export function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function localInputToIso(v) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d) ? '' : d.toISOString();
}

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch { prompt('Copy this:', text); }
}

export function setAccent(color) {
  if (/^#[0-9a-fA-F]{6}$/.test(color || '')) document.documentElement.style.setProperty('--accent', color);
}

export function randomId(n = 16) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'[b & 63]).join('');
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function base64ToBytes(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function registerSW() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

export function setTitle(t) { document.title = t ? `${t} – ${config.appName}` : config.appName; }

// Brand name from config on every page.
for (const el of document.querySelectorAll('[data-app-name]')) el.textContent = config.appName;

/** Run async jobs with at most n at a time. */
export function pool(n) {
  let active = 0;
  const waiting = [];
  const next = () => {
    if (active >= n || !waiting.length) return;
    const { fn, resolve, reject } = waiting.shift();
    active++;
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { waiting.push({ fn, resolve, reject }); next(); });
}

/** Call fn when the element scrolls near the viewport (once). */
export function whenVisible(el, fn) {
  if (!('IntersectionObserver' in window)) { fn(); return; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fn(); }
  }, { rootMargin: '400px' });
  io.observe(el);
}

/** Small LRU of object URLs: frees memory on long-running pages (TV wall, big albums). */
export function urlCache(max = 150) {
  const m = new Map();
  return {
    has: (k) => m.has(k),
    get(k) { const v = m.get(k); if (v !== undefined) { m.delete(k); m.set(k, v); } return v; },
    set(k, v) {
      m.delete(k); m.set(k, v);
      while (m.size > max) { const [ok, ov] = m.entries().next().value; m.delete(ok); setTimeout(() => URL.revokeObjectURL(ov), 30000); }
    },
  };
}
