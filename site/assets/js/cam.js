// Guest camera: join → shoot → photos saved locally → uploaded by the offline queue.
import { $, h, clear, toast, params, studioFrom, isEventId, store, setAccent, setTitle, fmtDate, fmtWhen, randomId, link, registerSW, frameGuard, config } from './util.js';
import { installButton } from './install.js';
import { api, ApiError } from './api.js';
import { LOOKS, applyLook, renderPixels, stampDate, drawScaled, canvasToBlob, blurScore, encodeBest, encodePreview } from './film.js';
import { openComposer } from './guestbook.js';
import { applyBrand, logoEl } from './brand.js';
import { queue, createUploader } from './queue.js';

frameGuard();
registerSW();

const root = $('#app');
const { q, f } = params();
let studio, eventId, ev, auth, uploader;
let shotsLeftServer = 0;
let pending = 0;

const ICON = {
  flip: 'M4 7h11l-3-3m3 3-3 3M20 17H9l3 3m-3-3 3-3',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  flash: 'M13 2 4 14h7l-1 8 9-12h-7z',
};
function icon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', ICON[name]);
  svg.append(p);
  return svg;
}

function screen(...children) {
  clear(root).append(h('main', { class: 'cam-screen' }, h('div', { class: 'panel stack' }, ...children)));
}

function fail(msg) {
  screen(h('h1', null, 'Hmm.'), h('p', null, msg), h('a', { class: 'btn', href: 'index.html' }, 'Go to the home page'));
}

const authKey = () => `ps:g:${studio}:${eventId}`;

async function boot() {
  try { studio = studioFrom(q); } catch { return fail('This link points to an unknown album.'); }
  eventId = q.get('e');
  if (!isEventId(eventId)) return fail('This link is missing its event code. Scan the QR code again.');
  screen(h('p', { class: 'muted' }, 'Opening the album…'));
  try {
    ev = (await api(studio, 'event', { e: eventId })).event;
  } catch (e) {
    return fail(e.code === 'not_found' ? 'We couldn’t find this event. It may have been removed.' : e.message);
  }
  applyBrand(ev);
  setTitle(ev.name);
  auth = store.get(authKey());
  if (auth) { auth.name = ev.name; auth.lastUsed = Date.now(); store.set(authKey(), auth); }
  if (auth) {
    try {
      const me = await api(studio, 'me', { e: eventId, g: auth.g, t: auth.t }, { retries: 1 });
      shotsLeftServer = me.guest.shotsLeft;
      if (me.key) { auth.key = me.key; store.set(authKey(), auth); }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'unauthorized') { store.del(authKey()); auth = null; }
      else shotsLeftServer = auth.shotsLeft ?? ev.shotsPerGuest; // offline: trust last known
    }
  }
  if (!auth) return welcome();
  startCamera();
}

function statusLine() {
  const now = ev.now || Date.now();
  if (ev.paused) return 'The host has paused uploads for now. Photos you take will upload when they resume.';
  if (ev.opensAt && Date.now() < Date.parse(ev.opensAt)) return `The camera opens ${fmtWhen(Date.parse(ev.opensAt))}.`;
  if (ev.closesAt && now > Date.parse(ev.closesAt)) return 'closed';
  return '';
}

/** Instagram, Facebook, TikTok, Snapchat, LINE… open links in their own browser, which often blocks the camera. */
const IN_APP = /Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|BytedanceWebview|Snapchat|\bLine\/|LinkedInApp|Pinterest/i.test(navigator.userAgent || '');

function welcome(errMsg) {
  const st = statusLine();
  if (st === 'closed') return closedScreen();
  const name = h('input', { type: 'text', maxlength: 24, autocomplete: 'given-name', placeholder: 'Optional', id: 'gname' });
  const pin = ev.needsPin ? h('input', { type: 'text', inputmode: 'numeric', maxlength: 8, class: 'code-input', id: 'gpin', autocomplete: 'off', value: f.get('p') || '' }) : null;
  const go = h('button', { class: 'btn flash block', type: 'submit' }, 'Open the camera');
  const form = h('form', { class: 'stack' },
    h('div', null,
      logoEl(studio, eventId, ev),
      h('h1', null, ev.name),
      ev.tagline ? h('p', { class: 'lede' }, ev.tagline) : null,
      ev.date ? h('p', { class: 'muted' }, fmtDate(ev.date)) : null,
      ev.welcome ? h('p', null, ev.welcome) : null),
    h('p', null, `You get ${ev.shotsPerGuest} shots${ev.allowVideo ? ', and any of them can be a short video' : ''}. Make them count.`),
    ev.approval ? h('p', { class: 'muted' }, 'The hosts approve photos before they appear in the album.') : null,
    ev.reveal === 'after' ? h('p', { class: 'muted' }, ev.revealAt ? `Everyone’s photos develop ${fmtWhen(Date.parse(ev.revealAt))}.` : 'Everyone’s photos develop after the event.') : null,
    st ? h('p', { class: 'callout' }, st) : null,
    IN_APP ? h('p', { class: 'callout warn' }, 'You opened this inside an app (like Instagram or Facebook), where the camera often doesn’t work. Tap the ••• or share menu and choose “Open in browser” (Safari or Chrome).') : null,
    h('label', { class: 'field' }, h('span', null, 'Your name'), name, h('small', null, 'Shown next to your photos. Leave blank to stay anonymous.')),
    pin ? h('label', { class: 'field' }, h('span', null, 'Event code'), pin, h('small', null, 'It’s printed on the sign at the event.')) : null,
    errMsg ? h('p', { class: 'callout warn', role: 'alert' }, errMsg) : null,
    go,
    h('p', { class: 'small muted' }, 'No app or account needed. Photos go straight to the hosts’ album.'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    go.disabled = true;
    go.textContent = 'Joining…';
    try {
      const r = await api(studio, 'join', { e: eventId, label: name.value.trim(), pin: pin ? pin.value.trim() : undefined });
      auth = { g: r.guest.id, t: r.token, label: r.guest.label, pin: pin ? pin.value.trim() : '', shotsLeft: r.guest.shotsLeft, name: ev.name, lastUsed: Date.now(), key: r.key || undefined };
      store.set(authKey(), auth);
      shotsLeftServer = r.guest.shotsLeft;
      startCamera();
    } catch (err) {
      welcome(err.code === 'pin_required' ? 'That code didn’t match. Check the sign and try again.' : err.message);
    }
  });
  screen(form);
}

function closedScreen() {
  screen(h('h1', null, ev.name), h('p', null, 'This album has closed. Thanks for the photos!'),
    h('a', { class: 'btn flash', href: link('album.html', { e: eventId, s: studio }) }, 'See the album'));
}

// ------------------------------------------------------------------ camera

let stream = null, facing = 'environment', mode = 'photo', look, flashOn = false, recorder = null, recTimer = null;
let beautyOn = true;
const BEAUTY = 0.3; // light touch: smooths skin a little, keeps detail
// Photos are kept at up to 12 MP (4032 px), like a phone's own camera.
const MAX_EDGE = 4032;
let hdOn = false, hdChosen = false;
let els = {};

function shotsLeft() { return Math.max(0, shotsLeftServer - pending); }

function renderCounter(tick) {
  els.counter.textContent = String(shotsLeft());
  if (tick) { els.counter.classList.remove('tick'); void els.counter.offsetWidth; els.counter.classList.add('tick'); }
  els.shutter.disabled = shotsLeft() <= 0 && !recorder;
  if (shotsLeft() <= 0 && !recorder) showOverlay('That’s a wrap!', 'Your roll is finished. Thanks for capturing the day.', true);
}

function showOverlay(title, text, withAlbum) {
  if (els.msg) els.msg.remove();
  els.msg = h('div', { class: 'cam-msg' }, h('div', { class: 'stack' },
    h('h2', null, title), h('p', null, text),
    withAlbum && ev.reveal !== 'after' && ev.guestGallery ? h('a', { class: 'btn flash', href: link('album.html', { e: eventId, s: studio }) }, 'See the album') : null,
    withAlbum && ev.reveal === 'after' ? h('p', { class: 'muted' }, ev.revealAt ? `The album develops ${fmtWhen(Date.parse(ev.revealAt))}.` : 'The album develops after the event.') : null));
  els.vf.append(els.msg);
}

function updateQueuePill(text) { els.queue.textContent = text || ''; }

async function startCamera() {
  const st = statusLine();
  if (st === 'closed') return closedScreen();
  look = ev.look in LOOKS ? ev.look : 'none';
  beautyOn = ev.beauty !== false && store.get('ps:beauty') !== 'off';
  const evKey = `${studio}:${eventId}`;
  pending = (await queue.list(evKey).catch(() => [])).length;

  els.video = h('video', { playsinline: true, muted: true, autoplay: true });
  els.video.muted = true;
  els.flashFx = h('div', { class: 'flash-overlay' });
  els.lookName = h('div', { class: 'look-name', 'aria-hidden': 'true' });
  els.preview = h('canvas', { class: 'vf-preview', 'aria-hidden': 'true' });
  els.vf = h('div', { class: 'viewfinder' }, els.video, els.preview, els.flashFx, els.lookName);
  els.counter = h('span', { class: 'counter-window', 'aria-live': 'polite' }, '');
  els.shutter = h('button', { class: 'shutter', 'aria-label': 'Take photo', onclick: onShutter });
  const flip = h('button', { class: 'ctrl', 'aria-label': 'Switch camera', onclick: flipCamera }, icon('flip'));
  const showMine = ev.reveal !== 'after' && ev.guestGallery;
  els.albumBtn = h('a', { class: 'ctrl', 'aria-label': showMine ? 'Open album' : 'Album', href: link('album.html', { e: eventId, s: studio }) }, icon('grid'));
  els.queue = h('div', { class: 'queue-pill', 'aria-live': 'polite' });

  const modeChips = [h('button', { class: 'chip', 'aria-pressed': 'true', onclick: () => setMode('photo') }, 'Photo')];
  if (ev.allowVideo) modeChips.push(h('button', { class: 'chip', 'aria-pressed': 'false', onclick: () => setMode('video') }, 'Video'));
  els.modeChips = modeChips;
  els.flashChip = h('button', { class: 'chip', 'aria-pressed': 'false', onclick: toggleFlash }, icon('flash'));
  els.flashChip.setAttribute('aria-label', 'Flash');
  const lookChips = ev.guestLooks ? Object.entries(LOOKS).map(([k, v]) =>
    h('button', { class: 'chip', 'aria-pressed': String(k === look), dataset: { look: k }, onclick: () => setLook(k) }, v.label)) : [];
  els.lookChips = lookChips;
  els.beautyChip = ev.beauty !== false ? h('button', { class: 'chip', 'aria-pressed': String(beautyOn), onclick: toggleBeauty }, 'Beauty') : null;
  const libInput = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden', onchange: (e) => fromFiles(e.target.files) });
  const fallbackInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden', onchange: (e) => fromFiles(e.target.files) });
  els.fallbackInput = fallbackInput;
  const libChip = ev.allowLibrary ? h('button', { class: 'chip', onclick: () => libInput.click() }, 'From library') : null;
  // HD: on phones the shutter opens the phone's own camera app for full quality (see updateHd);
  // looks and Beauty are applied afterwards.
  els.hdInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden', onchange: (e) => { fromCameraApp(e.target.files[0]); e.target.value = ''; } });
  els.hdChip = h('button', { class: 'chip', 'aria-pressed': 'false', hidden: true, onclick: () => setHd(!hdOn, true) }, 'HD');
  els.hdChip.setAttribute('aria-label', 'HD photos with your phone’s camera');
  { const saved = store.get('ps:hd'); if (saved === 'on' || saved === 'off') { hdChosen = true; hdOn = saved === 'on'; } }

  clear(root).append(h('div', { class: 'cam-shell' },
    h('header', { class: 'cam-top' },
      h('div', { class: 'cam-title-wrap' }, logoEl(studio, eventId, ev), h('div', { class: 'cam-title' }, ev.name)),
      h('div', { class: 'counter' }, els.counter, h('span', null, 'left'))),
    els.vf,
    h('footer', { class: 'cam-bottom' },
      h('div', { class: 'chips' }, ...modeChips, els.hdChip, els.flashChip, els.beautyChip, libChip, ...lookChips),
      h('div', { class: 'controls' }, els.albumBtn, els.shutter, flip),
      els.queue,
      h('div', { class: 'cam-links' },
        h('a', { href: link('album.html', { e: eventId, s: studio, extra: { view: 'mine' } }) }, 'My photos'),
        ev.guestbook ? h('button', { class: 'linkbtn', onclick: () => openComposer({ studio, eventId, auth, dark: true }) }, 'Sign the guestbook') : null,
        installButton('cam', 'linkbtn')),
      libInput, fallbackInput, els.hdInput)));
  renderCounter();
  applyLookPreview();

  uploader = createUploader({
    studio, ev: evKey,
    getAuth: () => auth,
    onEvent: (e) => {
      if (e.type === 'uploaded') {
        pending = Math.max(0, pending - 1);
        if (e.result && e.result.guest) shotsLeftServer = e.result.guest.shotsLeft;
        auth.shotsLeft = shotsLeftServer; store.set(authKey(), auth);
        updateQueuePill(pending ? `${pending} uploading…` : (ev.approval ? 'All photos uploaded ✓ They’ll appear once the hosts approve them.' : 'All photos uploaded ✓'));
        renderCounter();
      } else if (e.type === 'dropped') {
        pending = Math.max(0, pending - 1);
        toast(e.error.message || 'A photo couldn’t be uploaded.', 'error');
        if (e.error.code === 'no_shots') shotsLeftServer = 0;
        renderCounter();
      } else if (e.type === 'waiting') {
        // Say what is really happening: no signal, a weak connection, or the server saying "not yet".
        const n = `${e.count} saved on your phone`;
        const code = e.error && e.error.code;
        if (!navigator.onLine) updateQueuePill(`No signal. ${n}, they’ll upload when you’re back online.`);
        else if (!code || code === 'network') updateQueuePill(`Weak connection. ${n}, retrying…`);
        else if (code === 'busy' || code === 'rate_limited' || code === 'in_progress' || code === 'server_error') updateQueuePill(`Lots of photos arriving. ${n}, retrying shortly…`);
        else updateQueuePill(`${e.error.message || 'Can’t upload yet.'} ${n}, still trying.`);
      } else if (e.type === 'refresh') {
        api(studio, 'me', { e: eventId, g: auth.g, t: auth.t }, { retries: 1 }).then((me) => {
          if (me.key) { auth.key = me.key; store.set(authKey(), auth); uploader.kick(); }
        }).catch(() => {});
      } else if (e.type === 'auth') {
        store.del(authKey()); auth = null; welcome('Please join again to keep uploading. Your saved photos will upload afterwards.');
      }
    },
  });
  uploader.run();
  if (pending) updateQueuePill(`${pending} waiting to upload`);
  if (st) showOverlay('Hold that thought', st, false);
  await openStream();
}

async function openStream() {
  stopStream();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return cameraUnavailable();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // Photos: ask for the sensor's full 4:3 resolution. Videos: 1080p, the best that fits the upload limit.
      video: mode === 'video'
        ? { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }
        : { facingMode: { ideal: facing }, width: { ideal: 4032 }, height: { ideal: 3024 } },
      audio: mode === 'video',
    });
  } catch (e) {
    if (mode === 'video') { toast('Microphone blocked, recording without sound.'); try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } } }); } catch { return cameraUnavailable(e); } }
    else return cameraUnavailable(e);
  }
  els.video.srcObject = stream;
  els.video.classList.toggle('mirror', facing === 'user');
  els.preview.classList.toggle('mirror', facing === 'user');
  try { await els.video.play(); } catch { /* autoplay will resume on gesture */ }
  if (!els.video.videoWidth) await new Promise((r) => { els.video.onloadedmetadata = r; setTimeout(r, 1500); });
  const track = stream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  els.torch = !!caps.torch;
  // Full-resolution stills through the camera's photo pipeline where the browser supports it (Android Chrome).
  els.capture = null;
  if (track && window.ImageCapture) {
    try { els.capture = new ImageCapture(track); els.photoCaps = await els.capture.getPhotoCapabilities(); } catch { els.capture = null; }
  }
  updateHd();
}

/**
 * HD: the shutter opens the phone's own camera app, which runs the phone's full photo
 * processing (HDR, night mode, sharpening). Browsers can't use that processing, so on phones
 * HD is offered and on by default. Elsewhere only when the in-browser camera is low-res.
 */
const PHONE = /android|iphone|ipod/i.test(navigator.userAgent) || (/ipad/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
function updateHd() {
  const v = els.video;
  const lowRes = v.videoWidth * v.videoHeight < 5e6;
  const offer = mode === 'photo' && (PHONE || (!els.capture && lowRes));
  els.hdChip.hidden = !offer;
  if (!offer) { hdOn = false; return; }
  if (!hdChosen) setHd(true, false);
  else els.hdChip.setAttribute('aria-pressed', String(hdOn));
}
function setHd(on, byUser) {
  hdOn = on;
  if (byUser) { hdChosen = true; store.set('ps:hd', on ? 'on' : 'off'); }
  els.hdChip.setAttribute('aria-pressed', String(on));
  if (byUser && els.lookName) {
    els.lookName.textContent = on ? 'HD: uses your phone’s camera' : 'HD off: in-app camera';
    els.lookName.classList.remove('show'); void els.lookName.offsetWidth; els.lookName.classList.add('show');
  }
}

function stopStream() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}

function cameraUnavailable(err) {
  const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
  showOverlay(denied ? 'Camera access is off' : 'Camera not available',
    denied ? 'Allow camera access for this site in your browser settings, then reload. Or use your phone’s camera below.'
      : 'This browser can’t open the camera here. Use your phone’s camera instead.', false);
  els.msg.querySelector('.stack').append(
    h('button', { class: 'btn flash', onclick: () => els.fallbackInput.click() }, 'Use phone camera'),
    h('button', { class: 'btn', onclick: () => { els.msg.remove(); openStream(); } }, 'Try again'),
    h('a', { class: 'small', href: 'help.html#camera', target: '_blank', rel: 'noopener' }, 'How to fix this'));
}

function setMode(m) {
  if (recorder) return;
  mode = m;
  els.modeChips.forEach((c) => c.setAttribute('aria-pressed', String(c.textContent.toLowerCase() === m)));
  els.shutter.classList.toggle('video', m === 'video');
  els.shutter.setAttribute('aria-label', m === 'video' ? 'Start recording' : 'Take photo');
  applyLookPreview();
  openStream();
}

function setLook(k) {
  look = k;
  els.lookChips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.look === k)));
  applyLookPreview();
  if (els.lookName) {
    els.lookName.textContent = LOOKS[k].label;
    els.lookName.classList.remove('show'); void els.lookName.offsetWidth; els.lookName.classList.add('show');
  }
}

function toggleBeauty() {
  beautyOn = !beautyOn;
  store.set('ps:beauty', beautyOn ? 'on' : 'off');
  els.beautyChip.setAttribute('aria-pressed', String(beautyOn));
  applyLookPreview();
  if (els.lookName) {
    els.lookName.textContent = beautyOn ? 'Beauty on' : 'Beauty off';
    els.lookName.classList.remove('show'); void els.lookName.offsetWidth; els.lookName.classList.add('show');
  }
}

/**
 * Live preview: runs the exact same look + Beauty code as the photo, on a small copy of each
 * camera frame, so the viewfinder shows what will be saved. Videos record without looks, so the
 * preview is plain in video mode. Drops to a smaller size on slow phones.
 */
let previewOn = false, previewEdge = 480, previewBusy = false, frameMs = 0;
function applyLookPreview() {
  const want = mode === 'photo' && (look !== 'none' || beautyOn);
  els.vf.classList.toggle('previewing', want);
  if (want && !previewOn) { previewOn = true; requestAnimationFrame(previewFrame); }
  if (!want) previewOn = false;
}
function previewFrame() {
  if (!previewOn || !els.video || !document.body.contains(els.video)) { previewOn = false; return; }
  requestAnimationFrame(previewFrame);
  const v = els.video;
  if (previewBusy || document.hidden || !v.videoWidth) return;
  previewBusy = true;
  try {
    const t0 = performance.now();
    const scale = Math.min(1, previewEdge / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.max(1, Math.round(v.videoWidth * scale)), hh = Math.max(1, Math.round(v.videoHeight * scale));
    const c = els.preview;
    if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, w, hh);
    const img = ctx.getImageData(0, 0, w, hh);
    renderPixels(img.data, w, hh, look, { beauty: beautyOn ? BEAUTY : 0, grain: 0.4 });
    ctx.putImageData(img, 0, 0);
    frameMs = frameMs ? frameMs * 0.9 + (performance.now() - t0) * 0.1 : performance.now() - t0;
    if (frameMs > 55 && previewEdge > 320) { previewEdge = 320; frameMs = 0; }
  } catch { /* a dropped frame is fine */ }
  previewBusy = false;
}

/** Process the full-size photo in a worker so the camera never freezes; falls back to the main thread. */
let worker = null, workerFailed = false, jobId = 0;
const jobs = new Map();
function getWorker() {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL('./film-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const j = jobs.get(e.data.id); if (j) { jobs.delete(e.data.id); e.data.error ? j.reject(new Error(e.data.error)) : j.resolve(e.data.buf); } };
    worker.onerror = () => { workerFailed = true; worker = null; for (const j of jobs.values()) j.reject(new Error('worker')); jobs.clear(); };
  } catch { workerFailed = true; worker = null; }
  return worker;
}
async function processPhoto(canvas, name, opts) {
  if ((name === 'none' || !LOOKS[name]) && !(opts.beauty > 0)) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: hh } = canvas;
  const wk = getWorker();
  if (wk) {
    try {
      const img = ctx.getImageData(0, 0, w, hh);
      const id = ++jobId;
      const buf = await new Promise((resolve, reject) => {
        jobs.set(id, { resolve, reject });
        wk.postMessage({ id, buf: img.data.buffer, w, h: hh, look: name, opts }, [img.data.buffer]);
        setTimeout(() => { if (jobs.has(id)) { jobs.delete(id); reject(new Error('timeout')); } }, 20000);
      });
      ctx.putImageData(new ImageData(new Uint8ClampedArray(buf), w, hh), 0, 0);
      return;
    } catch { /* fall through to main thread */ }
  }
  applyLook(canvas, name, opts);
}

function toggleFlash() {
  flashOn = !flashOn;
  els.flashChip.setAttribute('aria-pressed', String(flashOn));
}

function flipCamera() {
  if (recorder) return;
  facing = facing === 'environment' ? 'user' : 'environment';
  openStream();
}

async function torch(on) {
  const t = stream && stream.getVideoTracks()[0];
  if (t && els.torch) { try { await t.applyConstraints({ advanced: [{ torch: on }] }); } catch { /* unsupported */ } }
}

async function onShutter() {
  if (mode === 'video') return recorder ? stopRecording() : startRecording();
  if (shotsLeft() <= 0) return;
  const v = els.video;
  if (hdOn) { els.hdInput.setAttribute('capture', facing === 'user' ? 'user' : 'environment'); els.hdInput.click(); return; }
  if (!v.videoWidth) { toast('Camera is still starting…'); return; }
  els.shutter.disabled = true;
  try {
    const realFlash = flashOn && facing === 'environment' && els.capture && els.photoCaps && (els.photoCaps.fillLightMode || []).includes('flash');
    if (flashOn && facing === 'environment' && els.torch && !realFlash) { await torch(true); await new Promise((r) => setTimeout(r, 300)); }
    if (flashOn && facing === 'user') { els.flashFx.style.opacity = '1'; await new Promise((r) => setTimeout(r, 250)); }
    const canvas = (await fullResStill(realFlash)) || drawScaled(v, v.videoWidth, v.videoHeight, MAX_EDGE);
    let blur = -1;
    try { blur = blurScore(canvas, canvas.width, canvas.height); } catch { /* optional */ }
    if (flashOn) { torch(false); els.flashFx.style.opacity = ''; }
    els.flashFx.classList.remove('go'); void els.flashFx.offsetWidth; els.flashFx.classList.add('go');
    if (navigator.vibrate) navigator.vibrate(15);
    await new Promise((r) => requestAnimationFrame(r));
    await processPhoto(canvas, look, { beauty: beautyOn ? BEAUTY : 0 });
    if (ev.dateStamp) stampDate(canvas);
    const blob = await encodeBest(canvas);
    const thumb = await encodePreview(canvas);
    await enqueue({ kind: 'photo', blob, thumb, w: canvas.width, h: canvas.height, blur });
    showLastShot(thumb);
    if (blur >= 0 && blur < 40) toast('That one looks blurry. Hold still for the next shot.');
  } catch (e) {
    toast('Couldn’t take that photo. Try again.', 'error');
  } finally {
    els.shutter.disabled = shotsLeft() <= 0;
  }
}

/** A still from the camera's photo pipeline (full sensor resolution, proper processing), or null. */
async function fullResStill(useFlash) {
  if (!els.capture) return null;
  try {
    const caps = els.photoCaps || {};
    const opts = {};
    if (caps.imageWidth && caps.imageWidth.max) opts.imageWidth = Math.min(caps.imageWidth.max, MAX_EDGE * 2);
    if (caps.imageHeight && caps.imageHeight.max) opts.imageHeight = Math.min(caps.imageHeight.max, MAX_EDGE * 2);
    if ((caps.fillLightMode || []).length) opts.fillLightMode = useFlash ? 'flash' : 'off';
    const blob = await Promise.race([els.capture.takePhoto(opts), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 6000))]);
    const src = await decodeImage(blob);
    const canvas = drawScaled(src.img, src.w, src.h, MAX_EDGE);
    src.done();
    return canvas;
  } catch {
    els.capture = null; // this phone can't: use the viewfinder frame from now on
    updateHd();
    return null;
  }
}

/** HD: a photo just taken with the phone's own camera app. Gets the look, Beauty and date stamp. */
async function fromCameraApp(file) {
  if (!file || !file.type.startsWith('image/')) return;
  if (shotsLeft() <= 0) { toast('Your roll is finished!'); return; }
  // Only fresh shots count as camera photos (unless the host allows the photo library)
  if (!ev.allowLibrary && file.lastModified && Date.now() - file.lastModified > 5 * 60 * 1000) {
    toast('Take a new photo with the camera (photos from your library aren’t allowed at this event).', 'error');
    return;
  }
  els.shutter.disabled = true;
  try {
    const src = await decodeImage(file);
    const canvas = drawScaled(src.img, src.w, src.h, MAX_EDGE);
    src.done();
    let blur = -1;
    try { blur = blurScore(canvas, canvas.width, canvas.height); } catch { /* optional */ }
    els.flashFx.classList.remove('go'); void els.flashFx.offsetWidth; els.flashFx.classList.add('go');
    await processPhoto(canvas, look, { beauty: beautyOn ? BEAUTY : 0 });
    if (ev.dateStamp) stampDate(canvas);
    const blob = await encodeBest(canvas);
    const thumb = await encodePreview(canvas);
    await enqueue({ kind: 'photo', blob, thumb, w: canvas.width, h: canvas.height, blur });
    showLastShot(thumb);
  } catch {
    toast('Couldn’t read that photo. Try again.', 'error');
  } finally {
    els.shutter.disabled = shotsLeft() <= 0;
    // Some phones stop the in-page camera while the camera app is open: restart it.
    const t = stream && stream.getVideoTracks()[0];
    if (!t || t.readyState === 'ended') openStream();
  }
}

/** The album button shows the last shot, so guests see the look they captured. */
let lastShotUrl = null;
function showLastShot(blob) {
  if (lastShotUrl) URL.revokeObjectURL(lastShotUrl);
  lastShotUrl = URL.createObjectURL(blob);
  els.albumBtn.style.backgroundImage = `url("${lastShotUrl}")`;
  els.albumBtn.classList.add('has-shot');
}

async function enqueue({ kind, blob, thumb, w, h: hh, dur = 0, blur = -1 }) {
  const item = { clientId: randomId(20), ev: `${studio}:${eventId}`, kind, blob, thumb, w, h: hh, dur, blur, createdAt: Date.now(), attempts: 0 };
  await queue.add(item);
  pending++;
  renderCounter(true);
  updateQueuePill(navigator.onLine ? 'Uploading…' : 'Saved on your phone, uploading when there’s signal');
  uploader.kick();
}

function pickMime() {
  const opts = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return opts.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

async function startRecording() {
  if (shotsLeft() <= 0) return;
  if (!stream || !els.video.videoWidth) { toast('Camera is still starting…'); return; }
  const mime = pickMime();
  if (!mime) { toast('Video recording isn’t supported in this browser.', 'error'); return; }
  const v = els.video;
  const poster = drawScaled(v, v.videoWidth, v.videoHeight, 1600);
  const chunks = [];
  const started = Date.now();
  // As sharp as the 20 MB upload limit allows for this event's longest clip (up to 8 Mbps).
  const vbps = Math.max(2_000_000, Math.min(8_000_000, Math.floor((19 * 1024 * 1024 * 8) / Math.max(3, ev.maxVideoSec)) - 128_000));
  recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: vbps, audioBitsPerSecond: 128_000 });
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = async () => {
    const type = mime.split(';')[0];
    const blob = new Blob(chunks, { type });
    const dur = Math.round((Date.now() - started) / 1000);
    recorder = null;
    els.shutter.classList.remove('recording');
    els.shutter.setAttribute('aria-label', 'Start recording');
    if (els.rec) els.rec.remove();
    if (blob.size > 20 * 1024 * 1024) { toast('That video is too long to upload. Try a shorter one.', 'error'); renderCounter(); return; }
    const thumb = await encodePreview(poster);
    await enqueue({ kind: 'video', blob, thumb, w: v.videoWidth, h: v.videoHeight, dur });
  };
  recorder.start(1000);
  els.shutter.classList.add('recording');
  els.shutter.setAttribute('aria-label', 'Stop recording');
  els.rec = h('div', { class: 'rec-badge' }, `● ${ev.maxVideoSec}s`);
  els.vf.append(els.rec);
  const tick = () => {
    if (!recorder) return;
    const left = ev.maxVideoSec - Math.floor((Date.now() - started) / 1000);
    els.rec.textContent = `● ${Math.max(0, left)}s`;
    if (left <= 0) stopRecording(); else recTimer = setTimeout(tick, 250);
  };
  tick();
}

function stopRecording() {
  clearTimeout(recTimer);
  if (recorder && recorder.state !== 'inactive') recorder.stop();
}

async function fromFiles(files) {
  for (const file of Array.from(files || [])) {
    if (shotsLeft() <= 0) { toast('Your roll is finished!'); break; }
    if (!file.type.startsWith('image/')) continue;
    if (file.size > 60 * 1024 * 1024) { toast('That photo is too big to add.', 'error'); continue; }
    try {
      const src = await decodeImage(file);
      const canvas = drawScaled(src.img, src.w, src.h, MAX_EDGE);
      src.done();
      const blob = await encodeBest(canvas); // re-encode: strips location data
      const thumb = await encodePreview(canvas);
      await enqueue({ kind: 'photo', blob, thumb, w: canvas.width, h: canvas.height });
    } catch {
      toast('That file couldn’t be read as a photo.', 'error');
    }
  }
}

/** Decode a picked file, respecting EXIF rotation; falls back to <img> on older Safari. */
async function decodeImage(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { img: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close && bmp.close() };
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (recorder) stopRecording(); stopStream(); }
  else if (els.video && auth) openStream();
});

boot();
