// "Add to home screen": puts an AfterFlash icon on the phone that opens full screen.
// Also remembers the last dashboard this device used (page, event code and studio only:
// never a key), so the icon can reopen it. Keys stay in the browser's own storage, where
// the host or admin chose to keep them.
import { h, store, isEventId, knownStudio } from './util.js';

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
window.addEventListener('appinstalled', () => { installPrompt = null; });

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

const TEXT = {
  cam: { title: 'Keep this camera handy', why: 'Tap the icon any time to jump straight back into this event’s camera.', opens: 'The AfterFlash icon opens your most recent event’s camera.' },
  host: { title: 'Keep this dashboard handy', why: 'Tap the icon to come straight back to this event’s dashboard.', opens: 'The icon opens the dashboard you used last. It only stays signed in if you tick “Remember me on this device” (Access tab).' },
  admin: { title: 'Keep your studio handy', why: 'Tap the icon to come straight back to your studio admin page.', opens: 'The icon opens your studio admin page. You’ll sign in again each time, so your admin key is never stored on the phone.' },
};

export function showInstall(kind = 'cam', { dark = kind === 'cam' } = {}) {
  const t = TEXT[kind] || TEXT.cam;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const close = () => overlay.remove();
  const body = installPrompt
    ? [h('p', null, 'Adds an AfterFlash icon to your phone. ' + t.why),
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

// ---- the last dashboard used on this device
const LAST = 'ps:last';
export function rememberPlace(p, s, e = '') {
  if (!knownStudio(s) || (p === 'host' && !isEventId(e)) || (p !== 'host' && p !== 'admin')) return;
  store.set(LAST, { p, s, e: p === 'host' ? e : '', t: Date.now() });
}
export function forgetPlace() { store.del(LAST); }
/** {p, s, e, t} when it's still safe to reopen, else null. A host place needs a remembered key. */
export function lastPlace() {
  const x = store.get(LAST);
  if (!x || typeof x !== 'object' || !knownStudio(x.s) || !(Number(x.t) > 0)) return null;
  if (x.p === 'admin') return { p: 'admin', s: x.s, e: '', t: Number(x.t) };
  if (x.p === 'host' && isEventId(x.e) && store.get(`ps:hk:${x.s}:${x.e}`)) return { p: 'host', s: x.s, e: x.e, t: Number(x.t) };
  return null;
}
