// Guest camera: join → shoot → photos saved locally → uploaded by the offline queue.
import { $, h, clear, toast, params, studioFrom, isEventId, store, setAccent, setTitle, fmtDate, fmtWhen, randomId, link, registerSW, frameGuard, config } from './util.js';
import { api, ApiError } from './api.js';
import { LOOKS, applyLook, stampDate, drawScaled, canvasToBlob, blurScore } from './film.js';
import { openComposer } from './guestbook.js';
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
  setAccent(ev.accent);
  setTitle(ev.name);
  auth = store.get(authKey());
  if (auth) { auth.name = ev.name; auth.lastUsed = Date.now(); store.set(authKey(), auth); }
  if (auth) {
    try {
      const me = await api(studio, 'me', { e: eventId, g: auth.g, t: auth.t }, { retries: 1 });
      shotsLeftServer = me.guest.shotsLeft;
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

function welcome(errMsg) {
  const st = statusLine();
  if (st === 'closed') return closedScreen();
  const name = h('input', { type: 'text', maxlength: 24, autocomplete: 'given-name', placeholder: 'Optional', id: 'gname' });
  const pin = ev.needsPin ? h('input', { type: 'text', inputmode: 'numeric', maxlength: 8, class: 'code-input', id: 'gpin', autocomplete: 'off', value: f.get('p') || '' }) : null;
  const go = h('button', { class: 'btn flash block', type: 'submit' }, 'Open the camera');
  const form = h('form', { class: 'stack' },
    h('div', null,
      h('h1', null, ev.name),
      ev.date ? h('p', { class: 'muted' }, fmtDate(ev.date)) : null,
      ev.welcome ? h('p', null, ev.welcome) : null),
    h('p', null, `You get ${ev.shotsPerGuest} shots${ev.allowVideo ? ', and any of them can be a short video' : ''}. Make them count.`),
    ev.approval ? h('p', { class: 'muted' }, 'The hosts approve photos before they appear in the album.') : null,
    ev.reveal === 'after' ? h('p', { class: 'muted' }, ev.revealAt ? `Everyone’s photos develop ${fmtWhen(Date.parse(ev.revealAt))}.` : 'Everyone’s photos develop after the event.') : null,
    st ? h('p', { class: 'callout' }, st) : null,
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
      auth = { g: r.guest.id, t: r.token, label: r.guest.label, pin: pin ? pin.value.trim() : '', shotsLeft: r.guest.shotsLeft, name: ev.name, lastUsed: Date.now() };
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
  look = ev.look in LOOKS ? ev.look : 'classic';
  const evKey = `${studio}:${eventId}`;
  pending = (await queue.list(evKey).catch(() => [])).length;

  els.video = h('video', { playsinline: true, muted: true, autoplay: true });
  els.video.muted = true;
  els.flashFx = h('div', { class: 'flash-overlay' });
  els.lookName = h('div', { class: 'look-name', 'aria-hidden': 'true' });
  els.vf = h('div', { class: 'viewfinder' }, els.video, h('div', { class: 'vignette' }), els.flashFx, els.lookName);
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
  const libInput = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden', onchange: (e) => fromFiles(e.target.files) });
  const fallbackInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden', onchange: (e) => fromFiles(e.target.files) });
  els.fallbackInput = fallbackInput;
  const libChip = ev.allowLibrary ? h('button', { class: 'chip', onclick: () => libInput.click() }, 'From library') : null;

  clear(root).append(h('div', { class: 'cam-shell' },
    h('header', { class: 'cam-top' },
      h('div', { class: 'cam-title' }, ev.name),
      h('div', { class: 'counter' }, els.counter, h('span', null, 'left'))),
    els.vf,
    h('footer', { class: 'cam-bottom' },
      h('div', { class: 'chips' }, ...modeChips, els.flashChip, libChip, ...lookChips),
      h('div', { class: 'controls' }, els.albumBtn, els.shutter, flip),
      els.queue,
      h('div', { class: 'cam-links' },
        h('a', { href: link('album.html', { e: eventId, s: studio, extra: { view: 'mine' } }) }, 'My photos'),
        ev.guestbook ? h('button', { class: 'linkbtn', onclick: () => openComposer({ studio, eventId, auth, dark: true }) }, 'Sign the guestbook') : null,
        isStandalone() ? null : h('button', { class: 'linkbtn', onclick: showInstall }, 'Add to home screen')),
      libInput, fallbackInput)));
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
      video: { facingMode: { ideal: facing }, width: { ideal: 2560 }, height: { ideal: 1440 } },
      audio: mode === 'video',
    });
  } catch (e) {
    if (mode === 'video') { toast('Microphone blocked, recording without sound.'); try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } } }); } catch { return cameraUnavailable(e); } }
    else return cameraUnavailable(e);
  }
  els.video.srcObject = stream;
  els.video.classList.toggle('mirror', facing === 'user');
  try { await els.video.play(); } catch { /* autoplay will resume on gesture */ }
  const track = stream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  els.torch = !!caps.torch;
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
    h('button', { class: 'btn', onclick: () => { els.msg.remove(); openStream(); } }, 'Try again'));
}

function setMode(m) {
  if (recorder) return;
  mode = m;
  els.modeChips.forEach((c) => c.setAttribute('aria-pressed', String(c.textContent.toLowerCase() === m)));
  els.shutter.classList.toggle('video', m === 'video');
  els.shutter.setAttribute('aria-label', m === 'video' ? 'Start recording' : 'Take photo');
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

/** Live preview of the film look on the viewfinder (the photo itself gets the full effect). */
function applyLookPreview() {
  for (const k of Object.keys(LOOKS)) els.vf.classList.remove('look-' + k);
  els.vf.classList.add('look-' + look);
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
  if (!v.videoWidth) { toast('Camera is still starting…'); return; }
  els.shutter.disabled = true;
  try {
    if (flashOn && facing === 'environment' && els.torch) { await torch(true); await new Promise((r) => setTimeout(r, 300)); }
    if (flashOn && facing === 'user') { els.flashFx.style.opacity = '1'; await new Promise((r) => setTimeout(r, 250)); }
    const canvas = drawScaled(v, v.videoWidth, v.videoHeight, 2560);
    let blur = -1;
    try { blur = blurScore(canvas, canvas.width, canvas.height); } catch { /* optional */ }
    if (flashOn) { torch(false); els.flashFx.style.opacity = ''; }
    els.flashFx.classList.remove('go'); void els.flashFx.offsetWidth; els.flashFx.classList.add('go');
    if (navigator.vibrate) navigator.vibrate(15);
    await new Promise((r) => requestAnimationFrame(r));
    applyLook(canvas, look);
    if (ev.dateStamp) stampDate(canvas);
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.88);
    const thumb = await canvasToBlob(drawScaled(canvas, canvas.width, canvas.height, 960), 'image/jpeg', 0.72);
    await enqueue({ kind: 'photo', blob, thumb, w: canvas.width, h: canvas.height, blur });
    showLastShot(thumb);
    if (blur >= 0 && blur < 40) toast('That one looks blurry. Hold still for the next shot.');
  } catch (e) {
    toast('Couldn’t take that photo. Try again.', 'error');
  } finally {
    els.shutter.disabled = shotsLeft() <= 0;
  }
}

// ------------------------------------------------------------------ add to home screen
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
function showInstall() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const close = () => overlay.remove();
  const body = installPrompt
    ? [h('p', null, 'Adds a PhotoShare icon to your phone. Tap it any time to jump straight back into this event’s camera.'),
      h('button', { class: 'btn flash', onclick: async () => { installPrompt.prompt(); await installPrompt.userChoice.catch(() => {}); installPrompt = null; close(); } }, 'Add to home screen')]
    : ios
      ? [h('p', null, 'Get back to this camera with one tap:'),
        h('ol', null, h('li', null, 'Tap the Share button (the square with an arrow) in Safari.'), h('li', null, 'Scroll down and tap “Add to Home Screen”.'), h('li', null, 'Tap “Add”.')),
        h('p', { class: 'small muted' }, 'The PhotoShare icon opens your most recent event’s camera.')]
      : [h('p', null, 'Open your browser’s menu (⋮) and choose “Add to Home screen” or “Install app”.'),
        h('p', { class: 'small muted' }, 'The PhotoShare icon opens your most recent event’s camera.')];
  const overlay = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add to home screen' },
    h('div', { class: 'panel stack dark-panel' }, h('h2', null, 'Keep this camera handy'), ...body, h('button', { class: 'btn', onclick: close }, 'Close')));
  document.body.append(overlay);
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
  const poster = drawScaled(v, v.videoWidth, v.videoHeight, 1024);
  const chunks = [];
  const started = Date.now();
  recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 96_000 });
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
    const thumb = await canvasToBlob(poster, 'image/jpeg', 0.78);
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
    try {
      const src = await decodeImage(file);
      const canvas = drawScaled(src.img, src.w, src.h, 2560);
      src.done();
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.88); // re-encode: strips location data
      const thumb = await canvasToBlob(drawScaled(canvas, canvas.width, canvas.height, 960), 'image/jpeg', 0.72);
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
