// "Add to home screen": puts an Rememberoll icon on the phone that opens full screen.
// Also remembers the last dashboard this device used (page, event code and studio only:
// never a key), so the icon can reopen it. Keys stay in the browser's own storage, where
// the host or admin chose to keep them.
import { h, store, isEventId, knownStudio, link } from './util.js';

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
window.addEventListener('appinstalled', () => { installPrompt = null; });

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

const TEXT = {
  app: { title: 'Get the app', why: 'Rememberoll opens full screen from its own icon, like any other app.', opens: 'The icon opens the Rememberoll home: scan a code, your events, hosting and partners.' },
  cam: { title: 'Keep this camera handy', why: 'Tap the icon any time to jump straight back into this event’s camera.', opens: 'The Rememberoll icon opens your most recent event’s camera.' },
  host: { title: 'Keep this dashboard handy', why: 'Tap the icon to come straight back to this event’s dashboard.', opens: 'The icon opens the dashboard you used last. It only stays signed in if you tick “Remember me on this device” (Access tab).' },
  admin: { title: 'Keep your studio handy', why: 'Tap the icon to come straight back to your studio admin page.', opens: 'The icon opens your studio admin page. You’ll sign in again each time, so your admin key is never stored on the phone.' },
};

export function showInstall(kind = 'cam', { dark = kind === 'cam' } = {}) {
  const t = TEXT[kind] || TEXT.cam;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const close = () => overlay.remove();
  const body = installPrompt
    ? [h('p', null, 'Adds an Rememberoll icon to your phone. ' + t.why),
      h('button', { class: 'btn flash', onclick: async () => { installPrompt.prompt(); await installPrompt.userChoice.catch(() => {}); installPrompt = null; close(); } }, 'Add to home screen')]
    : ios
      ? [h('p', null, t.why),
        h('ol', null, h('li', null, 'Open this page in Safari.'), h('li', null, 'Tap the Share button (the square with an arrow).'), h('li', null, 'Scroll down and tap “Add to Home Screen”.'), h('li', null, 'Tap “Add”.'))]
      : [h('p', null, t.why), h('p', null, 'Open your browser’s menu (⋮) and choose “Add to Home screen” or “Install app”.')];
  const overlay = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add to home screen' },
    h('div', { class: 'panel stack' + (dark ? ' dark-panel' : '') }, h('h2', null, t.title), ...body,
      h('p', { class: 'small muted' }, t.opens), h('button', { class: 'btn', onclick: close }, 'Close')));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);
}

/** A small "Add to home screen" button, or nothing when already opened from the icon. */
export function installButton(kind, cls = 'btn small') {
  return isStandalone() ? null : h('button', { class: cls, type: 'button', onclick: () => showInstall(kind) }, 'Add to home screen');
}

// ---- places this phone uses (page, studio, event code, name, time: never a key)
const LAST = 'ps:last';
const PLACES = 'ps:places';
const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 60);
export function rememberPlace(p, s, e = '', name = '') {
  if (!knownStudio(s) || (p === 'host' && !isEventId(e)) || (p !== 'host' && p !== 'admin')) return;
  const rec = { p, s, e: p === 'host' ? e : '', n: cleanName(name), t: Date.now() };
  store.set(LAST, rec);
  const list = (Array.isArray(store.get(PLACES)) ? store.get(PLACES) : []).filter((x) => x && !(x.p === rec.p && x.s === rec.s && x.e === rec.e));
  list.unshift(rec);
  store.set(PLACES, list.slice(0, 12));
}
export function forgetPlace() { store.del(LAST); }
const usable = (x) => {
  if (!x || typeof x !== 'object' || !knownStudio(x.s) || !(Number(x.t) > 0)) return null;
  const n = cleanName(x.n);
  if (x.p === 'admin') return { p: 'admin', s: x.s, e: '', n, t: Number(x.t) };
  if (x.p === 'host' && isEventId(x.e) && store.get(`ps:hk:${x.s}:${x.e}`)) return { p: 'host', s: x.s, e: x.e, n, t: Number(x.t) };
  return null;
};
/** {p, s, e, n, t} when it's still safe to reopen, else null. A host place needs a remembered key. */
export function lastPlace() { return usable(store.get(LAST)); }
/** Every dashboard this phone can reopen, newest first. */
export function myPlaces() {
  const list = Array.isArray(store.get(PLACES)) ? store.get(PLACES) : [];
  const out = list.map(usable).filter(Boolean);
  const last = lastPlace();
  if (last && !out.some((x) => x.p === last.p && x.s === last.s && x.e === last.e)) out.unshift(last);
  return out;
}
export const placeUrl = (x) => (x.p === 'host' ? link('host.html', { e: x.e, s: x.s }) : link('admin.html', { s: x.s }));

/** Events this phone joined as a guest (kept in this browser only). */
export function myEvents() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i) || '';
    const m = /^ps:g:([^:]+):([A-Za-z0-9]{6,20})$/.exec(k);
    if (!m || !knownStudio(m[1]) || !isEventId(m[2])) continue;
    const a = store.get(k) || {};
    out.push({ studio: m[1], id: m[2], name: typeof a.name === 'string' ? cleanName(a.name) : m[2], lastUsed: Number(a.lastUsed) || 0, key: k });
  }
  return out.sort((x, y) => y.lastUsed - x.lastUsed);
}

/** Invitations this phone replied to. */
export function myInvites() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i) || '';
    const m = /^ps:rsvp:([^:]+):([A-Za-z0-9]{6,20})$/.exec(k);
    if (!m || !knownStudio(m[1]) || !isEventId(m[2])) continue;
    const a = store.get(k) || {};
    if (!a.r) continue;
    out.push({ studio: m[1], id: m[2], name: cleanName(a.n) || 'Invitation', status: ['yes', 'maybe', 'no'].includes(a.st) ? a.st : '', t: Number(a.t) || 0 });
  }
  return out.sort((x, y) => y.t - x.t);
}
