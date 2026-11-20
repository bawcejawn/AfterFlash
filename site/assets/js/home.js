import { $, h, clear, frameGuard, isEventId, store, link, fmtWhen, config, myStudios, inStoreApp } from './util.js';
import { api } from './api.js';
import { isStandalone, lastPlace, myEvents } from './install.js';

frameGuard();

// Opened from the home-screen icon: the app home is the start page (once per launch, so the
// logo on any page still brings people here to switch events).
let launched = false;
try { launched = sessionStorage.getItem('ps:launched') === '1'; sessionStorage.setItem('ps:launched', '1'); } catch { /* private mode */ }
if (isStandalone() && !launched) location.replace('app.html');

const box = $('#my-events');
function renderMine() {
  const list = myEvents();
  const place = lastPlace();
  if (!list.length && !place) { box.hidden = true; return; }
  box.hidden = false;
  clear(box).append(
    h('h2', null, 'Your events'),
    place ? h('p', { class: 'row' }, h('a', { class: 'btn small primary', href: place.p === 'host' ? link('host.html', { e: place.e, s: place.s }) : link('admin.html', { s: place.s }) },
      place.p === 'host' ? 'Open my host dashboard' : 'Open my studio admin')) : null,
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
    clear(studioBox).append(h('h2', null, 'Your Rememberoll'),
      h('ul', { class: 'my-events' }, list.map((s) => h('li', null, h('b', null, s.name),
        h('a', { class: 'btn small primary', href: link('admin.html', { s: s.id }) }, 'Open my events')))));
  }
}

// ---- Rememberoll Cloud: sales sections, price, checkout
const cloud = config.cloud;
for (const el of document.querySelectorAll('[data-only]')) el.hidden = (el.dataset.only === 'cloud') !== !!cloud;
if (cloud) {
  const plans = (cloud.plans || []).filter((p) => p.on);
  const cheapest = plans.length ? plans[0].price : cloud.price;
  for (const el of document.querySelectorAll('[data-price]')) el.textContent = cheapest;
  const sup = $('#support');
  if (sup && cloud.support) sup.append(h('a', { href: 'mailto:' + cloud.support }, cloud.support));
  if (cloud.testMode) document.body.prepend(h('div', { class: 'test-banner' }, 'Test mode: no real charges. Pay with card 4242 4242 4242 4242, any future date, any CVC.'));
  const msg = $('#buy-msg');
  const box = $('#plans');
  if (!plans.length) msg.textContent = 'Sales open soon.';
  if (inStoreApp()) { plans.length = 0; msg.textContent = 'Plans aren’t sold in the app. Already have a key? Sign in to host.'; }

  // Referral codes: ?ref=CODE links are remembered for 60 days on this device, or typed in the box.
  const REF_KEY = 'ps:ref', REF_DAYS = 60;
  const norm = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  let ref = null; // { code, discount, prices }
  const fromUrl = norm(new URLSearchParams(location.search).get('ref'));
  if (fromUrl.length >= 3) {
    store.set(REF_KEY, { code: fromUrl, t: Date.now() });
    const u = new URL(location.href); u.searchParams.delete('ref'); history.replaceState(null, '', u.pathname + u.search + u.hash);
  }
  const saved = store.get(REF_KEY);
  const savedCode = saved && typeof saved.code === 'string' && Date.now() - Number(saved.t) < REF_DAYS * 86400000 ? norm(saved.code) : '';

  const priceEls = {};
  const draw = () => {
    for (const p of plans) {
      const el = clear(priceEls[p.id]);
      const now = ref && ref.prices && ref.prices[p.id] != null ? ref.prices[p.id] : p.cents;
      if (ref && now < p.cents) el.append(h('s', { class: 'was' }, p.price), ' ');
      el.append(fmt(now), h('small', null, 'one time'));
    }
  };
  const fmt = (c) => '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100));

  for (const p of plans) {
    const btn = h('button', { class: 'btn ' + (p.best ? 'flash' : 'primary'), type: 'button', dataset: { plan: p.id } }, p.id === 'event' ? 'Get 1 event' : `Get ${p.name.toLowerCase()}`);
    btn.addEventListener('click', async () => {
      for (const b of box.querySelectorAll('button')) b.disabled = true;
      msg.textContent = 'Opening secure checkout…';
      try {
        const { url } = await api('main', 'checkoutStart', { plan: p.id, ...(ref ? { ref: ref.code } : {}) }, { retries: 1 });
        if (!/^https:\/\/checkout\.stripe\.com\//.test(url)) throw new Error('Unexpected checkout address.');
        location.href = url;
      } catch (e) { msg.textContent = e.message; for (const b of box.querySelectorAll('button')) b.disabled = false; }
    });
    priceEls[p.id] = h('div', { class: 'price-tag' });
    box.append(h('div', { class: 'panel plan' + (p.best ? ' best' : '') },
      p.best ? h('span', { class: 'plan-badge' }, 'Best value') : null,
      h('h3', null, p.name), priceEls[p.id],
      h('p', { class: 'muted' }, p.note), btn));
  }
  draw();

  const refForm = $('#ref-form'), refInput = $('#ref-code'), refMsg = $('#ref-msg');
  const showRef = () => {
    clear(refMsg);
    if (ref) {
      const rm = h('button', { class: 'btn small ghost', type: 'button' }, 'Remove');
      rm.addEventListener('click', () => { ref = null; store.del(REF_KEY); refInput.value = ''; showRef(); draw(); });
      refMsg.append(`Code ${ref.code}: ${ref.discount}% off applied. `, rm);
    }
  };
  const apply = async (code, quiet) => {
    code = norm(code);
    if (code.length < 3) { if (!quiet) refMsg.textContent = 'Enter the code you were given.'; return; }
    try {
      ref = await api('main', 'refLookup', { code }, { retries: 1 });
      store.set(REF_KEY, { code: ref.code, t: Date.now() });
      refInput.value = ref.code;
    } catch (e) {
      ref = null;
      if (quiet) store.del(REF_KEY); else refMsg.textContent = e.message;
      draw(); return;
    }
    showRef(); draw();
  };
  if (refForm && plans.length) {
    refForm.hidden = false;
    refForm.addEventListener('submit', (e) => { e.preventDefault(); apply(refInput.value, false); });
    if (savedCode) apply(savedCode, true);
  }
}
