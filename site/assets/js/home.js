import { $, h, clear, frameGuard, isEventId, store, link, fmtWhen, config } from './util.js';

frameGuard();

// ---- events this phone has joined (kept in this browser only)
function myEvents() {
  const out = [];
  const studios = Object.keys(config.backends || {});
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i) || '';
    const m = /^ps:g:([^:]+):([A-Za-z0-9]{6,20})$/.exec(k);
    if (!m || !studios.includes(m[1]) || !isEventId(m[2])) continue;
    const a = store.get(k) || {};
    out.push({ studio: m[1], id: m[2], name: typeof a.name === 'string' ? a.name : m[2], lastUsed: Number(a.lastUsed) || 0, key: k });
  }
  return out.sort((x, y) => y.lastUsed - x.lastUsed);
}

const events = myEvents();
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// Opened from the home-screen icon: go straight to the camera of the event used in the last 3 days.
if (standalone && events[0] && Date.now() - events[0].lastUsed < 3 * 864e5) {
  location.replace(link('cam.html', { e: events[0].id, s: events[0].studio }));
}

const box = $('#my-events');
function renderMine() {
  const list = myEvents();
  if (!list.length) { box.hidden = true; return; }
  box.hidden = false;
  clear(box).append(
    h('h2', null, 'Your events'),
    h('ul', { class: 'my-events' }, list.map((ev) => h('li', null,
      h('div', null, h('b', null, ev.name), ev.lastUsed ? h('div', { class: 'small muted' }, `Last used ${fmtWhen(ev.lastUsed)}`) : null),
      h('div', { class: 'row' },
        h('a', { class: 'btn small flash', href: link('cam.html', { e: ev.id, s: ev.studio }) }, 'Camera'),
        h('a', { class: 'btn small', href: link('album.html', { e: ev.id, s: ev.studio }) }, 'Album'),
        h('button', { class: 'btn small', onclick: () => { if (confirm(`Remove “${ev.name}” from this phone? Photos already uploaded stay in the album.`)) { store.del(ev.key); renderMine(); } } }, 'Remove'))))));
}
renderMine();

const form = $('#join');
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = $('#code').value.trim();
  // Accept a bare code or a pasted link.
  let code = raw;
  try { const u = new URL(raw); code = u.searchParams.get('e') || ''; } catch { /* not a URL */ }
  if (!isEventId(code)) { $('#join-msg').textContent = 'That doesn’t look like an event code. It’s 10 letters and numbers on the sign.'; return; }
  location.href = 'cam.html?e=' + encodeURIComponent(code);
});
