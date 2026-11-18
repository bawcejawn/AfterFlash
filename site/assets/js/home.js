import { $, h, clear, frameGuard, isEventId, store, link, fmtWhen, config, knownStudio, myStudios } from './util.js';
import { api } from './api.js';

frameGuard();

// ---- events this phone has joined (kept in this browser only)
function myEvents() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i) || '';
    const m = /^ps:g:([^:]+):([A-Za-z0-9]{6,20})$/.exec(k);
    if (!m || !knownStudio(m[1]) || !isEventId(m[2])) continue;
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

// ---- studios this device organizes (friends who host their own events)
const studioBox = $('#my-studios');
if (studioBox) {
  const list = myStudios.list();
  if (list.length) {
    studioBox.hidden = false;
    clear(studioBox).append(h('h2', null, 'Your PhotoShare'),
      h('ul', { class: 'my-events' }, list.map((s) => h('li', null, h('b', null, s.name),
        h('a', { class: 'btn small primary', href: link('admin.html', { s: s.id }) }, 'Open my events')))));
  }
}

// ---- PhotoShare Cloud: sales sections, price, checkout
const cloud = config.cloud;
for (const el of document.querySelectorAll('[data-only]')) el.hidden = (el.dataset.only === 'cloud') !== !!cloud;
if (cloud) {
  for (const el of document.querySelectorAll('[data-price]')) el.textContent = cloud.price;
  const sup = $('#support');
  if (sup && cloud.support) sup.append(h('a', { href: 'mailto:' + cloud.support }, cloud.support));
  if (cloud.testMode) document.body.prepend(h('div', { class: 'test-banner' }, 'Test mode: no real charges. Pay with card 4242 4242 4242 4242, any future date, any CVC.'));
  const buy = $('#buy'), msg = $('#buy-msg');
  if (!cloud.payments) { buy.disabled = true; msg.textContent = 'Sales open soon.'; }
  buy.addEventListener('click', async () => {
    buy.disabled = true; msg.textContent = 'Opening secure checkout…';
    try {
      const { url } = await api('main', 'checkoutStart', {}, { retries: 1 });
      if (!/^https:\/\/checkout\.stripe\.com\//.test(url)) throw new Error('Unexpected checkout address.');
      location.href = url;
    } catch (e) { msg.textContent = e.message; buy.disabled = false; }
  });
}
