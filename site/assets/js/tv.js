// TV / projector photo wall. New photos jump the queue; otherwise the wall replays older ones.
import { $, h, clear, params, studioFrom, isEventId, isDriveId, setAccent, setTitle, fmtCountdown, link, qrSvg, loadDriveImage, serial, videoUrl, base64ToBytes } from './util.js';
import { api } from './api.js';

const root = $('#app');
const { q, f } = params();
const POLL_MS = 8000, SHOW_MS = 8000, LAST_CALL_MS = 45 * 60 * 1000;
let studio, eventId, wk, ev;
let known = new Map(); // id -> item
let fresh = []; // ids not yet featured
let version = '';
let current = null, imgs = [], which = 0;
let els = {};

function fail(msg) {
  clear(root).append(h('div', { class: 'tv-center' }, h('div', null, h('h2', null, 'Photo wall'), h('p', null, msg))));
}

async function boot() {
  try { studio = studioFrom(q); } catch { return fail('Unknown album in link.'); }
  eventId = q.get('e');
  wk = f.get('wk') || '';
  if (!isEventId(eventId)) return fail('This link is missing its event code.');
  try {
    ev = (await api(studio, 'event', { e: eventId })).event;
  } catch (e) { return fail(e.message); }
  setAccent(ev.accent);
  setTitle(ev.name + ' wall');
  build();
  await poll();
  setInterval(poll, POLL_MS);
  setInterval(chrome, 15000);
}

function build() {
  imgs = [h('img', { alt: '' }), h('img', { alt: '' })];
  els.who = h('div', { class: 'who', hidden: true });
  els.center = h('div', { class: 'tv-center', hidden: true });
  els.stage = h('div', { class: 'tv-stage' }, ...imgs, els.who, els.center);
  els.count = h('div', { class: 'tv-count' });
  els.thumbs = h('div', { class: 'tv-thumbs' });
  els.qrCap = h('div', { class: 'tv-qr-cap' }, 'Scan to add your photos');
  const joinUrl = link('cam.html', { e: eventId, s: studio });
  els.qr = h('div', { class: 'tv-qr' }, qrSvg(joinUrl));
  els.status = h('div', { class: 'tv-status', hidden: true }, 'Reconnecting…');
  els.banner = h('div', { class: 'tv-banner', hidden: true });
  const start = h('div', { class: 'tv-start' }, h('div', { class: 'stack' },
    h('button', { class: 'btn', onclick: startShow }, 'Start the show'),
    h('p', { class: 'muted' }, 'Goes full screen and keeps this screen awake.')));
  clear(root).append(
    h('div', { class: 'tv-shell' }, els.stage,
      h('aside', { class: 'tv-side' }, h('div', null, h('h1', { class: 'tv-name' }, ev.name), els.count), h('div', null, els.qr, els.qrCap), els.thumbs, h('div'))),
    els.banner, els.status, start);
  document.addEventListener('mousemove', () => { document.body.classList.add('cursor'); clearTimeout(els.curT); els.curT = setTimeout(() => document.body.classList.remove('cursor'), 2500); });
}

let wakeLock = null;
async function startShow(e) {
  e.currentTarget.closest('.tv-start').remove();
  try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch { /* not allowed */ }
  keepAwake();
}
async function keepAwake() {
  try { if ('wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); } } catch { /* ignore */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && wakeLock) keepAwake(); });

async function poll() {
  let r;
  try {
    r = await api(studio, 'list', { e: eventId, mode: 'wall', wk: wk || undefined, v: version || undefined }, { retries: 0, timeout: 20000 });
    els.status.hidden = true;
  } catch {
    els.status.hidden = false;
    return;
  }
  ev = r.event;
  version = r.v;
  chrome();
  if (r.unchanged) return;
  els.count.textContent = `${r.count || 0} photos`;
  if (!r.revealed) return showCenter('The photos are developing', ev.revealAt ? `Revealing in ${fmtCountdown(Date.parse(ev.revealAt) - Date.now())}` : 'They’ll appear after the event.');
  if (!r.items.length && r.count) return showCenter('This album is private', 'Ask the host for the wall link from their dashboard.');
  const next = new Map();
  for (const it of r.items || []) if (isDriveId(it.i)) next.set(it.i, it);
  // removed (hidden/deleted) photos leave immediately
  fresh = fresh.filter((id) => next.has(id));
  for (const id of next.keys()) if (!known.has(id)) fresh.push(id);
  const firstLoad = known.size === 0;
  known = next;
  if (firstLoad) fresh = [...known.values()].sort((a, b) => b.c - a.c).slice(0, 3).map((x) => x.i);
  renderThumbs();
  if (!known.size) return showCenter('Be the first!', 'Scan the code to start the album.');
  els.center.hidden = true;
  if (!current || !known.has(current)) advance();
}

function showCenter(title, text) {
  clear(els.center).append(h('div', null, h('h2', null, title), h('p', null, text)));
  els.center.hidden = false;
  imgs.forEach((i) => i.classList.remove('on'));
  els.who.hidden = true;
  current = null;
}

const proxyQueue = serial();
const proxied = new Map();
function proxyThumb(id) {
  if (proxied.has(id)) return Promise.resolve(proxied.get(id));
  return proxyQueue(async () => {
    const r = await api(studio, 'thumb', { e: eventId, id, wk: wk || undefined }, { retries: 1 });
    const url = URL.createObjectURL(new Blob([base64ToBytes(r.data)], { type: 'image/jpeg' }));
    proxied.set(id, url);
    return url;
  });
}
const posterOf = (it) => (it.k === 'v' && it.t ? it.t : it.i);

let nextT = null;
function scheduleNext(ms) {
  clearTimeout(nextT);
  nextT = setTimeout(() => { advance(); }, ms);
}

function renderThumbs() {
  const recent = [...known.values()].sort((a, b) => b.c - a.c).slice(0, 9);
  clear(els.thumbs).append(...recent.map((it) => loadDriveImage(h('img', { alt: '' }), posterOf(it), 300, { proxy: () => proxyThumb(it.i) })));
}

function advance() {
  if (!known.size) return;
  let id = fresh.shift();
  if (!id) {
    const all = [...known.keys()];
    id = all[Math.floor(Math.random() * all.length)];
    if (all.length > 1 && id === current) id = all[(all.indexOf(id) + 1) % all.length];
  }
  const it = known.get(id);
  if (!it) return;
  current = id;
  stopVideo();
  const img = imgs[which = 1 - which];
  const other = imgs[1 - which];
  loadDriveImage(img, posterOf(it), 1920, {
    proxy: () => proxyThumb(it.i),
    onReady: () => { img.classList.add('on'); other.classList.remove('on'); },
  });
  els.who.textContent = it.k === 'v' ? `${it.g || 'Guest'}, video` : it.g || '';
  els.who.hidden = !els.who.textContent;
  if (it.k === 'v') playVideo(it); else scheduleNext(SHOW_MS);
}

// Videos play muted on the wall (poster first, then the clip), then the wall moves on.
let vid = null;
function stopVideo() { if (vid) { vid.pause(); vid.remove(); vid = null; } }
function playVideo(it) {
  const v = h('video', { muted: true, playsinline: true, autoplay: true, preload: 'auto', class: 'tv-video', src: videoUrl(it.i) });
  v.muted = true;
  vid = v;
  const done = () => { if (vid === v) scheduleNext(1500); };
  v.addEventListener('playing', () => v.classList.add('on'));
  v.addEventListener('ended', done);
  v.addEventListener('error', () => { if (vid === v) { v.remove(); scheduleNext(SHOW_MS); } });
  els.stage.insertBefore(v, els.who);
  // safety net if the clip stalls or is long
  scheduleNext(Math.min(75000, Math.max(SHOW_MS, ((Number(it.d) || 15) + 4) * 1000)));
}

function chrome() {
  const closes = ev.closesAt ? Date.parse(ev.closesAt) : 0;
  const now = Date.now();
  if (closes && now > closes) {
    els.banner.textContent = 'The album is closed. Thanks for the photos!';
    els.banner.hidden = false;
  } else if (closes && closes - now < LAST_CALL_MS) {
    els.banner.textContent = `Last call! The album closes in ${fmtCountdown(closes - now)}`;
    els.banner.hidden = false;
  } else if (ev.paused) {
    els.banner.textContent = 'Uploads are paused for a moment';
    els.banner.hidden = false;
  } else {
    els.banner.hidden = true;
  }
}

boot();
