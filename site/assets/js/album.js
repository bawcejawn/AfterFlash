// Shared album: masonry grid, lightbox, download, report.
import { $, h, clear, toast, params, studioFrom, isEventId, isDriveId, store, setAccent, setTitle, fmtDate, fmtWhen, fmtCountdown, thumbUrl, downloadUrl, previewUrl, link, frameGuard, registerSW } from './util.js';
import { api } from './api.js';

frameGuard();
registerSW();

const root = $('#app');
const { q } = params();
let studio, eventId, ev, auth, pin = '';
let items = [], version = '', timer = null, lbIndex = -1, lb = null;

function fail(msg) {
  clear(root).append(h('main', { class: 'narrow section' }, h('h1', null, 'Hmm.'), h('p', null, msg), h('a', { class: 'btn', href: 'index.html' }, 'Go to the home page')));
}

async function boot() {
  try { studio = studioFrom(q); } catch { return fail('This link points to an unknown album.'); }
  eventId = q.get('e');
  if (!isEventId(eventId)) return fail('This link is missing its event code.');
  auth = store.get(`ps:g:${studio}:${eventId}`);
  pin = (auth && auth.pin) || store.get(`ps:pin:${studio}:${eventId}`, sessionStorage) || '';
  await refresh(true);
}

async function refresh(first) {
  let r;
  try {
    r = await api(studio, 'list', { e: eventId, pin: pin || undefined, v: first ? undefined : version }, { retries: first ? 2 : 0 });
  } catch (e) {
    if (e.code === 'pin_required') return askPin(first ? '' : 'That code didn’t match.');
    if (first) return fail(e.code === 'not_found' ? 'We couldn’t find this event.' : e.message);
    schedule();
    return;
  }
  ev = r.event;
  version = r.v;
  if (first) { setAccent(ev.accent); setTitle(ev.name); }
  if (!r.unchanged) {
    items = (r.items || []).filter((x) => isDriveId(x.i)).sort((a, b) => b.c - a.c);
    render(r);
  }
  schedule();
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => { if (!document.hidden) refresh(false); else schedule(); }, 20000);
}

function askPin(msg) {
  const input = h('input', { type: 'text', inputmode: 'numeric', class: 'code-input', maxlength: 8, autocomplete: 'off', 'aria-label': 'Event code' });
  const form = h('form', { class: 'narrow section stack' }, h('h1', null, 'Enter the event code'), h('p', null, 'This album is protected. The code is on the sign at the event.'),
    input, msg ? h('p', { class: 'callout warn', role: 'alert' }, msg) : null, h('button', { class: 'btn primary', type: 'submit' }, 'Open album'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    pin = input.value.trim();
    store.set(`ps:pin:${studio}:${eventId}`, pin, sessionStorage);
    refresh(true);
  });
  clear(root).append(form);
  input.focus();
}

function render(r) {
  const head = h('header', { class: 'album-head row spread' },
    h('div', null, h('h1', null, ev.name), h('p', { class: 'muted' }, [fmtDate(ev.date), `${r.count || 0} photos`].filter(Boolean).join(', '))),
    !ev.closesAt || Date.now() < Date.parse(ev.closesAt) ? h('a', { class: 'btn flash', href: link('cam.html', { e: eventId, s: studio }) }, 'Open the camera') : null);
  const body = [];
  if (!r.revealed) {
    const at = ev.revealAt ? Date.parse(ev.revealAt) : 0;
    body.push(h('div', { class: 'empty' },
      h('p', null, 'The photos are still developing.'),
      at ? h('p', { class: 'countdown' }, fmtCountdown(at - Date.now())) : null,
      at ? h('p', null, `The album opens ${fmtWhen(at)}.`) : h('p', null, 'The hosts will open the album after the event.')));
  } else if (!ev.guestGallery) {
    body.push(h('div', { class: 'empty' }, h('p', null, 'The hosts are keeping this album private. Thanks for adding your photos!')));
  } else if (!items.length) {
    body.push(h('div', { class: 'empty' }, h('p', null, 'No photos yet. Be the first!')));
  } else {
    body.push(h('div', { class: 'masonry' }, items.map((it, i) => {
      const img = h('img', { src: thumbUrl(it.k === 'v' && it.t ? it.t : it.i, 600), alt: it.g ? `Photo by ${it.g}` : 'Guest photo', loading: 'lazy', decoding: 'async' });
      if (it.w && it.h) { img.width = 600; img.height = Math.round((600 * it.h) / it.w); }
      return h('button', { class: 'tile', onclick: () => openLb(i), 'aria-label': 'Open photo' }, img, it.k === 'v' ? h('span', { class: 'vid' }, 'Video') : null);
    })));
  }
  clear(root).append(head, ...body);
}

function openLb(i) {
  lbIndex = i;
  if (!lb) {
    lb = {
      el: h('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photo viewer' }),
      stage: h('div', { class: 'lb-stage' }),
      who: h('span'),
    };
    const close = h('button', { class: 'btn small', onclick: closeLb }, 'Close');
    lb.dl = h('a', { class: 'btn small', rel: 'noopener', target: '_blank' }, 'Download');
    lb.report = h('button', { class: 'btn small', onclick: report }, 'Report');
    lb.el.append(
      h('div', { class: 'lb-top' }, lb.who, close),
      lb.stage,
      h('div', { class: 'lb-bottom' }, h('button', { class: 'btn small', onclick: () => step(-1), 'aria-label': 'Previous' }, 'Previous'),
        h('div', { class: 'row' }, lb.dl, lb.report), h('button', { class: 'btn small', onclick: () => step(1), 'aria-label': 'Next' }, 'Next')));
    document.addEventListener('keydown', (e) => {
      if (!lb.el.isConnected) return;
      if (e.key === 'Escape') closeLb();
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    });
  }
  showLb();
  document.body.append(lb.el);
  lb.el.querySelector('button').focus();
}

function showLb() {
  const it = items[lbIndex];
  if (!it) return closeLb();
  clear(lb.stage).append(it.k === 'v'
    ? h('iframe', { src: previewUrl(it.i), title: 'Video', allow: 'autoplay; fullscreen', referrerpolicy: 'no-referrer', sandbox: 'allow-scripts allow-same-origin' })
    : h('img', { src: thumbUrl(it.i, 2000), alt: it.g ? `Photo by ${it.g}` : 'Guest photo' }));
  lb.who.textContent = [it.g, fmtWhen(it.c)].filter(Boolean).join(', ');
  lb.dl.setAttribute('href', downloadUrl(it.i));
  lb.report.hidden = !(auth && ev.allowReports);
}

function step(d) { lbIndex = (lbIndex + d + items.length) % items.length; showLb(); }
function closeLb() { if (lb) lb.el.remove(); }

async function report() {
  const it = items[lbIndex];
  if (!it || !confirm('Hide this photo and let the hosts know? They’ll decide if it comes back.')) return;
  try {
    await api(studio, 'report', { e: eventId, g: auth.g, t: auth.t, id: it.i });
    items.splice(lbIndex, 1);
    toast('Thanks. The photo is hidden while the hosts take a look.', 'ok');
    closeLb();
    render({ revealed: true, count: items.length });
  } catch (e) {
    toast(e.message, 'error');
  }
}

boot();
