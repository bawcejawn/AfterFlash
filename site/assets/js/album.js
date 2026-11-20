// Shared album: masonry grid, hosts' picks, lightbox (enhance, download, report),
// "My photos" (works before the reveal) and the guestbook.
import { urlCache,
  $, h, clear, toast, params, studioFrom, isEventId, isDriveId, store, setAccent, setTitle, fmtDate, fmtWhen, fmtCountdown,
  downloadUrl, previewUrl, videoUrl, link, frameGuard, registerSW, loadDriveImage, pool, whenVisible,
} from './util.js';
import { mediaBlob } from './crypto.js';
import { applyBrand, logoEl, plannerCredit } from './brand.js';
import { api } from './api.js';
import { enhance, canvasToBlob } from './film.js';
import { openComposer, renderNotes } from './guestbook.js';

frameGuard();
registerSW();

const root = $('#app');
const { q } = params();
let studio, eventId, ev, auth, pin = '';
let items = [], version = '', timer = null, lbIndex = -1, lb = null, lastList = null;
let view = ['mine', 'guestbook'].includes(q.get('view')) ? q.get('view') : 'album';
let picksOnly = false;
let challengeOnly = '';
let mineItems = [];
let enhanceOn = store.get('ps:enhance') === true;
let albumKey = '';

function fail(msg) {
  clear(root).append(h('main', { class: 'narrow section' }, h('h1', null, 'Hmm.'), h('p', null, msg), h('a', { class: 'btn', href: 'index.html' }, 'Go to the home page')));
}

const guestAuth = () => (auth ? { g: auth.g, t: auth.t } : {});

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
  albumKey = r.key || (auth && auth.key) || albumKey;
  if (first) { applyBrand(ev); setTitle(ev.name); }
  if (!r.unchanged) {
    items = (r.items || []).filter((x) => isDriveId(x.i)).sort((a, b) => b.c - a.c);
    lastList = r;
    if (view === 'album' || first) render();
  }
  schedule();
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => { if (!document.hidden && view === 'album') refresh(false); else schedule(); }, 20000);
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

// ------------------------------------------------------------------ layout
function render() {
  const r = lastList || { revealed: false, count: 0 };
  const open = !ev.closesAt || Date.now() < Date.parse(ev.closesAt);
  const head = h('header', { class: 'album-head row spread' },
    h('div', null, logoEl(studio, eventId, ev), h('h1', null, ev.name), ev.tagline ? h('p', null, ev.tagline) : null, h('p', { class: 'muted' }, [fmtDate(ev.date), `${r.count || 0} photos`].filter(Boolean).join(', '))),
    open ? h('a', { class: 'btn flash', href: link('cam.html', { e: eventId, s: studio }) }, 'Open the camera') : null);
  const tabs = [['album', 'Album']];
  if (auth) tabs.push(['mine', 'My photos']);
  if (ev.guestbook) tabs.push(['guestbook', 'Guestbook']);
  const tabBar = tabs.length > 1 ? h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([id, label]) =>
    h('button', { role: 'tab', 'aria-selected': String(view === id), onclick: () => { view = id; render(); } }, label))) : null;
  const body = h('div');
  clear(root).append(head, tabBar, body, plannerCredit(ev) || '');
  if (view === 'mine' && auth) return renderMine(body);
  if (view === 'guestbook' && ev.guestbook) return renderGuestbook(body);
  renderAlbum(body, r);
}

const proxyQueue = pool(3);
const proxied = urlCache(300);
/**
 * Fetch a preview through the backend: the fallback for Google URLs, the way "My photos"
 * works, and the only way for private-storage events (decrypted here, on the device).
 */
function proxyThumb(id) {
  if (proxied.has(id)) return Promise.resolve(proxied.get(id));
  return proxyQueue(async () => {
    const r = await api(studio, 'thumb', { e: eventId, id, pin: pin || undefined, ...guestAuth() }, { retries: 1 });
    const url = URL.createObjectURL(await mediaBlob(r, albumKey));
    proxied.set(id, url);
    return url;
  });
}

/** Full photo or video, decrypted if needed. */
async function fullMedia(it) {
  const r = await api(studio, 'photo', { e: eventId, id: it.i, pin: pin || undefined, ...guestAuth() }, { retries: 1, timeout: 120000 });
  return mediaBlob(r, albumKey);
}

function renderAlbum(body, r) {
  if (!r.revealed) {
    const at = ev.revealAt ? Date.parse(ev.revealAt) : 0;
    body.append(h('div', { class: 'empty' },
      h('p', null, 'The photos are still developing.'),
      at ? h('p', { class: 'countdown' }, fmtCountdown(at - Date.now())) : null,
      at ? h('p', null, `The album opens ${fmtWhen(at)}.`) : h('p', null, 'The hosts will open the album after the event.'),
      auth ? h('p', null, h('button', { class: 'btn', onclick: () => { view = 'mine'; render(); } }, 'See my photos')) : null));
    return;
  }
  if (!ev.guestGallery) { body.append(h('div', { class: 'empty' }, h('p', null, 'The hosts are keeping this album private. Thanks for adding your photos!'))); return; }
  if (!items.length) {
    body.append(h('div', { class: 'empty' }, h('p', null, r.pending ? `${r.pending} photo${r.pending > 1 ? 's are' : ' is'} waiting for the hosts to approve.` : 'No photos yet. Be the first!')));
    return;
  }
  const picks = items.filter((x) => x.f);
  const challengeNames = [...new Set(items.map((x) => x.ch).filter(Boolean))];
  if (challengeNames.length) {
    body.append(h('div', { class: 'row album-filter challenge-filter', role: 'group', 'aria-label': 'Photo challenges' },
      h('span', { class: 'small muted' }, 'Challenges:'),
      challengeNames.map((n) => h('button', { class: 'btn small' + (challengeOnly === n ? ' primary' : ''), 'aria-pressed': String(challengeOnly === n), onclick: () => { challengeOnly = challengeOnly === n ? '' : n; render(); } },
        `${n} (${items.filter((x) => x.ch === n).length})`))));
  }
  if (picks.length) {
    body.append(h('div', { class: 'row album-filter' },
      h('button', { class: 'btn small' + (picksOnly ? '' : ' primary'), onclick: () => { picksOnly = false; render(); } }, `All (${items.length})`),
      h('button', { class: 'btn small' + (picksOnly ? ' primary' : ''), onclick: () => { picksOnly = true; render(); } }, `♥ Hosts’ picks (${picks.length})`)));
  }
  let shown = picksOnly && picks.length ? picks : items;
  if (challengeOnly) shown = shown.filter((x) => x.ch === challengeOnly);
  if (r.pending) body.append(h('p', { class: 'callout' }, `${r.pending} new photo${r.pending > 1 ? 's are' : ' is'} waiting for the hosts to approve.`));
  body.append(h('div', { class: 'masonry' }, shown.map((it, idx) => {
    const img = h('img', { alt: it.g ? `Photo by ${it.g}` : 'Guest photo', loading: 'lazy', decoding: 'async' });
    if (it.w && it.h) { img.width = 600; img.height = Math.round((600 * it.h) / it.w); }
    if (ev.encrypted) whenVisible(img, () => proxyThumb(it.i).then((u) => { if (u) img.src = u; }).catch(() => img.classList.add('img-failed')));
    else loadDriveImage(img, it.k === 'v' && it.t ? it.t : it.i, 600, { proxy: () => proxyThumb(it.i) });
    const tile = h('button', { class: 'tile', onclick: () => openLb(shown, idx), 'aria-label': 'Open photo' }, img,
      it.k === 'v' ? h('span', { class: 'vid' }, 'Video') : null, it.f ? h('span', { class: 'fav-badge', 'aria-label': 'Hosts’ pick' }, '♥') : null,
      it.cap ? h('span', { class: 'tile-caption' }, it.cap) : null);
    return tile;
  })));
}

async function renderMine(body) {
  body.append(h('p', { class: 'muted' }, 'Loading your photos…'));
  try {
    mineItems = (await api(studio, 'mine', { e: eventId, ...guestAuth() })).items.filter((x) => isDriveId(x.i)).sort((a, b) => b.c - a.c);
  } catch (e) { clear(body).append(h('p', null, e.message)); return; }
  const label = { visible: '', pending: 'Waiting for the hosts', hidden: 'Hidden by the hosts', reported: 'Under review' };
  clear(body).append(
    h('p', { class: 'muted' }, mineItems.length ? `You’ve taken ${mineItems.length}. Only you can see this page.` : 'Photos you take on this phone will appear here.'),
    h('div', { class: 'masonry' }, mineItems.map((it, i) => {
      const img = h('img', { alt: 'Your photo', loading: 'lazy' });
      whenVisible(img, () => proxyThumb(it.i).then((u) => { if (u) img.src = u; }).catch(() => img.classList.add('img-failed')));
      return h('button', { class: 'tile', onclick: () => openLb(mineItems, i, true) }, img,
        it.k === 'v' ? h('span', { class: 'vid' }, 'Video') : null,
        label[it.s] ? h('span', { class: 'tile-note' }, label[it.s]) : null);
    })));
}

async function renderGuestbook(body) {
  const canWrite = auth && ev.guestbook && (!ev.closesAt || Date.now() < Date.parse(ev.closesAt));
  if (canWrite) body.append(h('p', null, h('button', { class: 'btn flash', onclick: () => openComposer({ studio, eventId, auth, onDone: () => render() }) }, 'Sign the guestbook')));
  const list = h('div', null, h('p', { class: 'muted' }, 'Loading messages…'));
  body.append(list);
  try {
    const { notes } = await api(studio, 'guestbookList', { e: eventId, pin: pin || undefined });
    clear(list).append(lastList && !lastList.revealed ? h('p', { class: 'empty' }, 'Messages appear here when the album opens.') : renderNotes(notes, (id) => api(studio, 'noteAudio', { e: eventId, id, pin: pin || undefined }, { timeout: 60000 }), albumKey));
  } catch (e) { clear(list).append(h('p', null, e.message)); }
}

// ------------------------------------------------------------------ lightbox
let lbList = [], lbMine = false;
function openLb(list, i, mine = false) {
  lbList = list; lbIndex = i; lbMine = mine;
  if (!lb) {
    lb = {
      el: h('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photo viewer' }),
      stage: h('div', { class: 'lb-stage' }),
      who: h('span'),
    };
    const close = h('button', { class: 'btn small', onclick: closeLb }, 'Close');
    lb.enh = h('button', { class: 'btn small', 'aria-pressed': String(enhanceOn), onclick: toggleEnhance }, 'Enhance');
    lb.dl = h('button', { class: 'btn small', onclick: download }, 'Download');
    lb.report = h('button', { class: 'btn small', onclick: report }, 'Report');
    lb.el.append(
      h('div', { class: 'lb-top' }, lb.who, h('div', { class: 'row' }, lb.enh, close)),
      lb.stage,
      h('div', { class: 'lb-bottom' }, h('button', { class: 'btn small', onclick: () => step(-1) }, 'Previous'),
        h('div', { class: 'row' }, lb.dl, lb.report), h('button', { class: 'btn small', onclick: () => step(1) }, 'Next')));
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

const cur = () => lbList[lbIndex];

let showToken = 0;
const lbUrls = [];
const keepUrl = (u) => { lbUrls.push(u); return u; };
function showLb() {
  const it = cur();
  if (!it) return closeLb();
  const token = ++showToken;
  let media;
  for (const u of lbUrls.splice(0)) URL.revokeObjectURL(u);
  if (it.k === 'v' && (ev.encrypted || lbMine)) {
    // Private storage, or your own video (it may not be public yet): fetched through the app.
    media = h('video', { controls: true, playsinline: true });
    proxyThumb(it.i).then((u) => { if (u && token === showToken) media.poster = u; }).catch(() => {});
    lb.who.textContent = 'Loading video…';
    fullMedia(it).then((b) => { if (token === showToken) { media.src = keepUrl(URL.createObjectURL(b)); lb.who.textContent = [it.cap ? `“${it.cap}”` : '', it.g, it.ch ? `Challenge: ${it.ch}` : '', fmtWhen(it.c)].filter(Boolean).join(', '); } })
      .catch((e) => { if (token === showToken) toast(e.message, 'error'); });
  } else if (it.k === 'v') {
    media = h('video', { controls: true, playsinline: true, preload: 'metadata', src: videoUrl(it.i) });
    if (it.t) loadDriveImage(new Image(), it.t, 1280, { onReady: (im) => { media.poster = im.src; } });
    media.addEventListener('error', () => {
      if (!media.isConnected) return;
      media.replaceWith(h('iframe', { src: previewUrl(it.i), title: 'Video', allow: 'autoplay; fullscreen', referrerpolicy: 'no-referrer', sandbox: 'allow-scripts allow-same-origin allow-popups' }));
    });
  } else {
    media = h('img', { alt: it.g ? `Photo by ${it.g}` : 'Guest photo' });
    if (lbMine || ev.encrypted) {
      proxyThumb(it.i).then((u) => { if (u && token === showToken && !media.dataset.full) media.src = u; }).catch(() => {});
      if (ev.encrypted && !(enhanceOn && ev.enhance)) {
        fullMedia(it).then((b) => { if (token === showToken && !media.dataset.enhanced) { media.dataset.full = '1'; media.src = keepUrl(URL.createObjectURL(b)); } }).catch(() => {});
      }
    } else loadDriveImage(media, it.i, 2000, { proxy: () => proxyThumb(it.i) });
    if (enhanceOn && ev.enhance) applyEnhanced(media, it, token);
  }
  clear(lb.stage).append(media);
  lb.who.textContent = [it.cap ? `“${it.cap}”` : '', it.g, it.ch ? `Challenge: ${it.ch}` : '', fmtWhen(it.c)].filter(Boolean).join(', ');
  const canEnhance = ev.enhance && it.k !== 'v';
  lb.enh.hidden = !canEnhance;
  lb.enh.setAttribute('aria-pressed', String(enhanceOn));
  lb.enh.textContent = enhanceOn ? 'Enhance: on' : 'Enhance: off';
  lb.report.hidden = lbMine || !(auth && ev.allowReports);
  lb.dl.textContent = enhanceOn && canEnhance ? 'Download enhanced' : 'Download';
}

/** Enhanced view from the full-size original (the normal photo shows until it's ready). */
const enhancedCache = new Map();
async function applyEnhanced(img, it, token) {
  try {
    let url = enhancedCache.get(it.i);
    if (!url) {
      lb.who.textContent = 'Enhancing…';
      const full = await fullMedia(it);
      if (token !== showToken) return;
      const raw = URL.createObjectURL(full);
      const c = await canvasFromUrl(raw);
      URL.revokeObjectURL(raw);
      await new Promise((res) => setTimeout(res, 0));
      const blob = await canvasToBlob(enhance(c), 'image/jpeg', 0.92);
      url = URL.createObjectURL(blob);
      enhancedCache.set(it.i, url);
    }
    if (token !== showToken) return;
    img.dataset.enhanced = '1';
    img.onload = null; img.onerror = null;
    img.src = url;
    lb.who.textContent = [it.cap ? `“${it.cap}”` : '', it.g, it.ch ? `Challenge: ${it.ch}` : '', fmtWhen(it.c)].filter(Boolean).join(', ');
  } catch { if (token === showToken) toast('Couldn’t enhance this photo.', 'error'); }
}

function canvasFromUrl(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      c.getContext('2d').drawImage(im, 0, 0);
      resolve(c);
    };
    im.onerror = reject;
    im.src = url;
  });
}

function toggleEnhance() {
  enhanceOn = !enhanceOn;
  store.set('ps:enhance', enhanceOn);
  showLb();
}

async function download() {
  const it = cur();
  if (!it) return;
  const viaApp = ev.encrypted || lbMine;
  if (it.k === 'v' && !viaApp) { window.open(downloadUrl(it.i), '_blank', 'noopener'); return; }
  const wantEnhanced = enhanceOn && ev.enhance && it.k !== 'v';
  if (!wantEnhanced && !viaApp) { window.open(downloadUrl(it.i), '_blank', 'noopener'); return; }
  const label = lb.dl.textContent;
  lb.dl.disabled = true;
  lb.dl.textContent = 'Preparing…';
  try {
    let blob = await fullMedia(it);
    if (wantEnhanced && enhancedCache.has(it.i)) {
      blob = await (await fetch(enhancedCache.get(it.i))).blob();
    } else if (wantEnhanced) {
      const url = URL.createObjectURL(blob);
      const c = await canvasFromUrl(url);
      URL.revokeObjectURL(url);
      blob = await canvasToBlob(enhance(c), 'image/jpeg', 0.92);
    }
    const ext = { 'video/mp4': 'mp4', 'video/webm': 'webm' }[blob.type] || 'jpg';
    const href = URL.createObjectURL(blob);
    h('a', { href, download: `${eventId}-${it.i.slice(0, 8)}${wantEnhanced ? '-enhanced' : ''}.${ext}` }).click();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  } catch (e) { toast(e.message || 'Download failed', 'error'); }
  lb.dl.disabled = false;
  lb.dl.textContent = label;
}

function step(d) { lbIndex = (lbIndex + d + lbList.length) % lbList.length; showLb(); }
function closeLb() { if (lb) lb.el.remove(); }

async function report() {
  const it = cur();
  if (!it || !confirm('Hide this photo and let the hosts know? They’ll decide if it comes back.')) return;
  try {
    await api(studio, 'report', { e: eventId, g: auth.g, t: auth.t, id: it.i });
    items = items.filter((x) => x.i !== it.i);
    if (lastList) lastList.count = Math.max(0, (lastList.count || 1) - 1);
    toast('Thanks. The photo is hidden while the hosts take a look.', 'ok');
    closeLb();
    render();
  } catch (e) {
    toast(e.message, 'error');
  }
}

boot();
